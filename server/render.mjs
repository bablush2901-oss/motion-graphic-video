import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function exportProject(project, baseUrl, mediaRegistry) {
  mediaRegistry.assertKnown(project.audio);
  mediaRegistry.assertKnown(project.narrator);
  const result = structuredClone(project);
  if (result.audio) result.audio.url = `${baseUrl}${result.audio.url}`;
  if (result.narrator) result.narrator.url = `${baseUrl}${result.narrator.url}`;
  return result;
}

export class RenderQueue {
  constructor({rootDirectory, dataDirectory, baseUrl, mediaRegistry, browserExecutable}) {
    this.rootDirectory = rootDirectory;
    this.outputDirectory = path.join(dataDirectory, 'exports');
    this.baseUrl = baseUrl;
    this.mediaRegistry = mediaRegistry;
    this.browserExecutable = browserExecutable;
    this.jobs = new Map();
    this.queue = [];
    this.active = false;
    this.bundlePromise = undefined;
  }

  async initialize() { await fs.mkdir(this.outputDirectory, {recursive: true}); }

  enqueue(project, quality) {
    if (this.queue.length >= 4) throw Object.assign(new Error('The export queue is full. Wait for an export to finish.'), {status: 429});
    const safeProject = exportProject(project, this.baseUrl, this.mediaRegistry);
    // Keep recent status records while exported files remain available on disk.
    for (const [id, job] of this.jobs) {
      if (this.jobs.size < 50) break;
      if (['done', 'error', 'cancelled'].includes(job.status)) this.jobs.delete(id);
    }
    const job = {id: randomUUID(), status: 'queued', progress: 0, project: safeProject, quality, cancelled: false};
    this.jobs.set(job.id, job);
    this.queue.push(job);
    void this.processNext();
    return {id: job.id};
  }

  publicJob(job) {
    if (!job) return undefined;
    return {
      id: job.id, status: job.status, progress: job.progress,
      ...(job.status === 'done' ? {url: `/exports/${job.id}.mp4`} : {}),
      ...(job.error ? {error: job.error} : {}),
    };
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (['done', 'error', 'cancelled'].includes(job.status)) return this.publicJob(job);
    job.cancelled = true;
    job.status = 'cancelled';
    job.cancel?.();
    this.queue = this.queue.filter((queued) => queued.id !== id);
    return this.publicJob(job);
  }

  async getBundle() {
    if (!this.bundlePromise) {
      this.bundlePromise = import('@remotion/bundler').then(({bundle}) => bundle({
        entryPoint: path.join(this.rootDirectory, 'src', 'remotion', 'index.tsx'),
        rootDir: this.rootDirectory,
        onProgress: () => {},
      })).catch((error) => { this.bundlePromise = undefined; throw error; });
    }
    return this.bundlePromise;
  }

  async processNext() {
    if (this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = true;
    const outputLocation = path.join(this.outputDirectory, `.pending-${job.id}.mp4`);
    const completedLocation = path.join(this.outputDirectory, `${job.id}.mp4`);
    try {
      job.status = 'bundling';
      const [serveUrl, renderer] = await Promise.all([this.getBundle(), import('@remotion/renderer')]);
      if (job.cancelled) return;
      const {cancel, cancelSignal} = renderer.makeCancelSignal();
      job.cancel = cancel;
      const inputProps = {project: job.project};
      const browser = this.browserExecutable ? {browserExecutable: this.browserExecutable} : {};
      const composition = await renderer.selectComposition({serveUrl, id: 'MotionVideo', inputProps, ...browser});
      if (job.cancelled) return;
      const scale = job.quality === '720p' ? 2 / 3 : 1;
      job.status = 'rendering';
      job.progress = 0.03;
      await renderer.renderMedia({
        serveUrl,
        composition, scale,
        inputProps, outputLocation, codec: 'h264', audioCodec: 'aac', crf: job.quality === '1080p' ? 18 : 22,
        concurrency: 2, ...browser, cancelSignal,
        onProgress: ({progress}) => { if (!job.cancelled) job.progress = Math.max(0.03, Math.min(0.99, progress)); },
      });
      if (!job.cancelled) {
        // Only a completed MP4 gets the public filename. An interrupted server
        // cannot accidentally expose a partial export after it restarts.
        await fs.rename(outputLocation, completedLocation);
        if (job.cancelled) await fs.rm(completedLocation, {force: true});
        else { job.status = 'done'; job.progress = 1; }
      }
    } catch (error) {
      if (!job.cancelled) {
        job.status = 'error';
        const message = error instanceof Error ? error.message : 'Unknown export failure.';
        job.error = /browser|chrome|chromium|executable|ENOENT/i.test(message)
          ? 'The render browser is missing or could not start. Run npm run setup, then retry. If Chrome is installed, you can set CHROME_EXECUTABLE in .env.'
          : /media|audio|video|decode|codec/i.test(message)
            ? 'A media file could not be decoded. Convert the narrator to H.264 MP4 and audio to MP3 or WAV, then re-upload and retry.'
            : `Export failed: ${message.slice(0, 500)}`;
        console.error(`Export ${job.id} failed:`, message);
      }
    } finally {
      if (job.cancelled || job.status === 'error') await fs.rm(outputLocation, {force: true}).catch(() => {});
      delete job.cancel;
      delete job.project;
      this.active = false;
      void this.processNext();
    }
  }
}
