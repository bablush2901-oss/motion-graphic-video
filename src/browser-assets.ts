import type {MediaAsset, Project} from '../shared/types';

const DATABASE_NAME = 'motion-studio-media';
const STORE_NAME = 'assets';
export const MAX_BROWSER_UPLOAD_BYTES = 200 * 1024 * 1024;
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
const VIDEO_EXTENSIONS = ['mp4', 'webm'];
const MIME_TYPES: Record<string, string[]> = {
  mp3: ['audio/mpeg', 'audio/mp3'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
  aac: ['audio/aac', 'audio/x-aac'],
  ogg: ['audio/ogg', 'application/ogg'],
  flac: ['audio/flac', 'audio/x-flac'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
};

interface StoredAsset {
  id: string;
  asset: MediaAsset;
  blob: Blob;
}
interface ResolvedAsset {
  asset: MediaAsset;
  objectUrl: string;
}

let databasePromise: Promise<IDBDatabase> | undefined;
const resolvedAssets = new Map<string, ResolvedAsset>();
const pendingAssets = new Map<string, Promise<ResolvedAsset | undefined>>();

function storageError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  if (name === 'QuotaExceededError') {
    return new Error('This browser does not have enough storage for that media file. Choose a smaller file or free some browser storage.');
  }
  if (name === 'SecurityError' || name === 'InvalidStateError' || name === 'NotAllowedError') {
    return new Error('Browser media storage is unavailable. Allow site storage or open the app in a normal browser window, then re-upload your media.');
  }
  return new Error('Could not read or save media in this browser. Check available browser storage and try again.');
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    try {
      if (typeof indexedDB === 'undefined') {
        throw new DOMException('IndexedDB is unavailable.', 'SecurityError');
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, {keyPath: 'id'});
        }
      };
      request.onerror = () => {
        settled = true;
        reject(storageError(request.error));
      };
      request.onblocked = () => {
        settled = true;
        reject(new Error('Close other Motion Studio tabs and try uploading again so browser media storage can open.'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        settled = true;
        resolve(database);
      };
    } catch (error) {
      settled = true;
      reject(storageError(error));
    }
  });
  databasePromise.catch(() => {databasePromise = undefined;});
  return databasePromise;
}

async function readStoredAsset(id: string): Promise<StoredAsset | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(id);
      let record: StoredAsset | undefined;
      request.onsuccess = () => {record = request.result as StoredAsset | undefined;};
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(storageError(transaction.error || request.error));
      transaction.onabort = () => reject(storageError(transaction.error || request.error));
    } catch (error) {
      reject(storageError(error));
    }
  });
}

async function writeStoredAsset(record: StoredAsset): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const request = transaction.objectStore(STORE_NAME).put(record);
      // Wait for the entire transaction to commit before reporting an upload.
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(storageError(transaction.error || request.error));
      transaction.onabort = () => reject(storageError(transaction.error || request.error));
    } catch (error) {
      reject(storageError(error));
    }
  });
}

function validHeader(extension: string, header: Uint8Array): boolean {
  const text = String.fromCharCode(...header);
  const mpeg = header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0;
  if (extension === 'mp3') return text.startsWith('ID3') || mpeg;
  if (extension === 'aac') return mpeg;
  if (extension === 'wav') return text.startsWith('RIFF') && text.slice(8, 12) === 'WAVE';
  if (extension === 'ogg') return text.startsWith('OggS');
  if (extension === 'flac') return text.startsWith('fLaC');
  if (extension === 'm4a' || extension === 'mp4') return text.slice(4, 8) === 'ftyp';
  if (extension === 'webm') return header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
  return false;
}

/** Save bytes locally; return a stable reference suitable for project JSON. */
export async function saveBrowserAsset(file: File, kind: 'audio' | 'video'): Promise<MediaAsset> {
  if (kind !== 'audio' && kind !== 'video') throw new Error('Upload kind must be audio or video.');
  if (file.size > MAX_BROWSER_UPLOAD_BYTES) throw new Error('Files must be 200 MB or smaller.');
  const filename = file.name.replace(/\\/g, '/').split('/').pop() || '';
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const allowed = kind === 'audio' ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
  if (!allowed.includes(extension)) {
    throw new Error(kind === 'video' ? 'Use an MP4 or WebM narrator video.' : 'Use an MP3, WAV, M4A, AAC, OGG, or FLAC audio file.');
  }
  if (file.type && file.type !== 'application/octet-stream' && !MIME_TYPES[extension].includes(file.type)) {
    throw new Error('The file type does not match its extension. Choose a supported audio or video file.');
  }
  let header: Uint8Array;
  try {header = new Uint8Array(await file.slice(0, 32).arrayBuffer());}
  catch {throw new Error('Could not read that media file. Select it again and retry.');}
  if (!file.size || !validHeader(extension, header)) {
    throw new Error('The file contents do not match a supported audio or video format.');
  }
  const id = crypto.randomUUID();
  const asset: MediaAsset = {
    id,
    name: filename.replace(/[\u0000-\u001f]/g, '').slice(0, 255) || `upload.${extension}`,
    url: `/media/${id}.${extension}`,
    kind,
  };
  // A supported MIME type also helps browsers decode files with an empty type.
  await writeStoredAsset({id, asset, blob: file.slice(0, file.size, MIME_TYPES[extension][0])});
  return {...asset};
}

/** Load the original logical reference, without replacing it with a blob URL. */
export async function loadBrowserAsset(id: string): Promise<MediaAsset | undefined> {
  const record = await readStoredAsset(id);
  return record?.asset ? {...record.asset} : undefined;
}

function missingAsset(asset: MediaAsset): Error {
  return new Error(`The ${asset.kind === 'video' ? 'narrator video' : 'audio file'} “${asset.name}” is not stored in this browser. Re-upload it to preview or export this project.`);
}

async function objectUrlFor(asset: MediaAsset): Promise<string> {
  let known = resolvedAssets.get(asset.id);
  if (!known) {
    let pending = pendingAssets.get(asset.id);
    if (!pending) {
      pending = readStoredAsset(asset.id).then(record => {
        if (!record || !(record.blob instanceof Blob) || !record.blob.size || record.asset.id !== asset.id) return undefined;
        const resolved = {asset: record.asset, objectUrl: URL.createObjectURL(record.blob)};
        resolvedAssets.set(asset.id, resolved);
        return resolved;
      });
      pendingAssets.set(asset.id, pending);
    }
    try {known = await pending;}
    finally {pendingAssets.delete(asset.id);}
  }
  if (!known || known.asset.kind !== asset.kind || (known.asset.url !== asset.url && known.objectUrl !== asset.url)) {
    throw missingAsset(asset);
  }
  return known.objectUrl;
}

/** Resolve only a clone for playback/rendering; saved project references stay stable. */
export async function resolveBrowserProject(project: Project): Promise<Project> {
  const resolved = structuredClone(project);
  await Promise.all([
    resolved.audio ? objectUrlFor(resolved.audio).then(url => {resolved.audio = {...resolved.audio!, url};}) : Promise.resolve(),
    resolved.narrator ? objectUrlFor(resolved.narrator).then(url => {resolved.narrator = {...resolved.narrator!, url};}) : Promise.resolve(),
  ]);
  return resolved;
}
