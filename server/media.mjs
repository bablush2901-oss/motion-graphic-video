import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaSchema} from './validation.mjs';

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
export const VIDEO_EXTENSIONS = ['mp4', 'webm'];
const MIME_TYPES = {
  mp3: ['audio/mpeg', 'audio/mp3'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
  aac: ['audio/aac', 'audio/x-aac'],
  ogg: ['audio/ogg', 'application/ogg'],
  flac: ['audio/flac', 'audio/x-flac'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
};

export function validateMediaHeader(extension, buffer) {
  const text = buffer.toString('ascii');
  const mpeg = buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  if (extension === 'mp3') return text.startsWith('ID3') || mpeg;
  if (extension === 'aac') return mpeg;
  if (extension === 'wav') return text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE';
  if (extension === 'ogg') return text.startsWith('OggS');
  if (extension === 'flac') return text.startsWith('fLaC');
  if (extension === 'm4a' || extension === 'mp4') return text.slice(4, 8) === 'ftyp';
  if (extension === 'webm') return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export function mediaExtension(name, kind) {
  const extension = path.extname(name).slice(1).toLowerCase();
  const allowed = kind === 'audio' ? AUDIO_EXTENSIONS : kind === 'video' ? VIDEO_EXTENSIONS : [];
  if (!allowed.includes(extension)) throw Object.assign(new Error(
    kind === 'video' ? 'Use an MP4 or WebM narrator video.' : 'Use an MP3, WAV, M4A, AAC, OGG, or FLAC audio file.',
  ), {status: 400});
  return extension;
}

export class MediaRegistry {
  constructor(dataDirectory) {
    this.uploadsDirectory = path.join(dataDirectory, 'uploads');
    this.manifestPath = path.join(dataDirectory, 'uploads.json');
    this.assets = new Map();
    this.writeChain = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.uploadsDirectory, {recursive: true});
    try {
      const assets = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
      if (!Array.isArray(assets)) return;
      for (const entry of assets) {
        const parsed = mediaSchema.safeParse(entry);
        if (!parsed.success || path.basename(parsed.data.url).split('.')[0] !== parsed.data.id) continue;
        try {
          const stats = await fs.stat(this.filePath(parsed.data));
          if (stats.isFile()) this.assets.set(parsed.data.id, parsed.data);
        } catch { /* A removed upload is not restored. */ }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not restore the upload index. Re-upload any missing media.');
    }
  }

  filePath(asset) {
    return path.join(this.uploadsDirectory, path.basename(asset.url));
  }

  findFilename(filename) {
    for (const asset of this.assets.values()) if (path.basename(asset.url) === filename) return asset;
    return undefined;
  }

  assertKnown(asset) {
    if (!asset) return;
    const known = this.assets.get(asset.id);
    if (!known || known.url !== asset.url || known.kind !== asset.kind) {
      throw Object.assign(new Error('A media file is missing or is not a local upload. Re-upload it before exporting.'), {status: 400});
    }
  }

  async accept(file, kind) {
    if (!file) throw Object.assign(new Error('Choose a file to upload.'), {status: 400});
    try {
      if (!['audio', 'video'].includes(kind)) throw Object.assign(new Error('Upload kind must be audio or video.'), {status: 400});
      const extension = mediaExtension(file.originalname, kind);
      if (file.mimetype && file.mimetype !== 'application/octet-stream' && !MIME_TYPES[extension].includes(file.mimetype)) {
        throw Object.assign(new Error('The file type does not match its extension. Choose a supported audio or video file.'), {status: 400});
      }
      const handle = await fs.open(file.path, 'r');
      let header;
      try {
        const buffer = Buffer.alloc(32);
        const result = await handle.read(buffer, 0, 32, 0);
        header = buffer.subarray(0, result.bytesRead);
      } finally { await handle.close(); }
      if (file.size === 0 || !validateMediaHeader(extension, header)) {
        throw Object.assign(new Error('The file contents do not match a supported audio or video format.'), {status: 400});
      }
      const id = randomUUID();
      const asset = mediaSchema.parse({
        id, name: path.basename(file.originalname.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').slice(0, 255) || `upload.${extension}`,
        url: `/media/${id}.${extension}`, kind,
      });
      await fs.rename(file.path, this.filePath(asset));
      this.assets.set(id, asset);
      try {
        await this.save();
      } catch (error) {
        this.assets.delete(id);
        await fs.rm(this.filePath(asset), {force: true});
        throw error;
      }
      return asset;
    } finally {
      await fs.rm(file.path, {force: true}).catch(() => {});
    }
  }

  save() {
    const snapshot = JSON.stringify([...this.assets.values()], null, 2);
    const write = this.writeChain.catch(() => {}).then(async () => {
      const temporary = `${this.manifestPath}.tmp`;
      await fs.writeFile(temporary, snapshot, 'utf8');
      await fs.rename(temporary, this.manifestPath);
    });
    this.writeChain = write;
    return write;
  }
}
