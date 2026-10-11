import type {WebRendererContainer, WebRendererVideoCodec, WebRendererAudioCodec} from '@remotion/web-renderer';
import {MotionVideo} from './remotion/MotionVideo';
import {dimensionsFor, durationFrames, type Project} from '../shared/types';

export type BrowserRenderJob = {
  id: string;
  status: 'queued' | 'bundling' | 'rendering' | 'done' | 'error' | 'cancelled';
  progress: number;
  url?: string;
  error?: string;
  filename?: string;
  format?: 'mp4' | 'webm';
  note?: string;
};

type PendingRender = {
  job: BrowserRenderJob;
  project: Project;
  quality: '720p' | '1080p';
  controller: AbortController;
};

type Encoding = {
  container: WebRendererContainer;
  videoCodec: WebRendererVideoCodec;
  audioCodec: WebRendererAudioCodec;
};

const jobs = new Map<string, BrowserRenderJob>();
const controllers = new Map<string, AbortController>();
let queue: PendingRender[] = [];
let active = false;
const finished = new Set(['done', 'error', 'cancelled']);
const encodings: Encoding[] = [
  {container: 'mp4', videoCodec: 'h264', audioCodec: 'aac'},
  {container: 'webm', videoCodec: 'vp9', audioCodec: 'opus'},
  {container: 'webm', videoCodec: 'vp8', audioCodec: 'opus'},
];

function publicJob(job: BrowserRenderJob): BrowserRenderJob {
  return {...job};
}

function pruneCompletedJobs() {
  // Object URLs hold the exported video in memory. Retain a small recent history
  // and release old exports before starting another potentially large render.
  for (const [id, job] of jobs) {
    if (jobs.size < 6) break;
    if (!finished.has(job.status)) continue;
    if (job.url) URL.revokeObjectURL(job.url);
    jobs.delete(id);
    controllers.delete(id);
  }
}

function exportFilename(title: string, container: string) {
  const basename = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').trim().slice(0, 80);
  return `${basename || 'motion-studio'}.${container}`;
}

function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/WebCodecs|VideoEncoder|AudioEncoder|WebGL|No supported video codec|cannot be encoded by this browser/i.test(message)) {
    return `This browser could not encode the video. Open the live app in an updated Chrome or Edge browser and retry. ${message.slice(0, 240)}`;
  }
  if (/media|audio|decode|demux|codec|fetch|CORS|network/i.test(message)) {
    return `A media file or encoder could not be read by this browser. Use H.264 MP4 for the narrator and MP3 or WAV for audio, then re-upload and retry. ${message.slice(0, 240)}`;
  }
  return `Export failed: ${message.slice(0, 450)}`;
}

async function renderNext() {
  if (active) return;
  const pending = queue.shift();
  if (!pending) return;
  active = true;
  const {job, project, quality, controller} = pending;
  const {signal} = controller;
  try {
    if (signal.aborted) return;
    job.status = 'bundling';
    if (!window.isSecureContext || typeof VideoEncoder === 'undefined') {
      throw new Error('WebCodecs is unavailable. Use the HTTPS live link in an updated Chrome or Edge browser.');
    }
    // The browser renderer is intentionally loaded only when exporting so the
    // editor and Player can become interactive without its encoding bundle.
    const renderer = await import('@remotion/web-renderer');
    if (signal.aborted) return;
    const {width, height} = dimensionsFor(project.aspectRatio);
    const scale = quality === '720p' ? 2 / 3 : 1;
    const muted = !project.audio && (!project.narrator || project.narratorVolume === 0);
    let encoding: Encoding | undefined;
    const failures: string[] = [];
    for (const candidate of encodings) {
      const capabilities = await renderer.canRenderMediaOnWeb({
        ...candidate, width, height, scale, muted,
        videoBitrate: 'high', audioBitrate: 'high', outputTarget: 'arraybuffer',
      });
      if (signal.aborted) return;
      if (capabilities.canRender) {
        encoding = candidate;
        break;
      }
      failures.push(...capabilities.issues.filter(issue => issue.severity === 'error').map(issue => issue.message));
    }
    if (!encoding) {
      throw new Error(`No supported video codec is available in this browser. ${[...new Set(failures)].join(' ')}`);
    }
    job.format = encoding.container as 'mp4' | 'webm';
    job.filename = exportFilename(project.title, encoding.container);
    if (encoding.container === 'webm') {
      job.note = 'This browser cannot encode MP4 with H.264. Your video will download as WebM with the uploaded audio included.';
    }
    job.status = 'rendering';
    job.progress = 0.01;
    const result = await renderer.renderMediaOnWeb({
      composition: {
        id: 'MotionVideo', component: MotionVideo, defaultProps: {project},
        width, height, fps: project.fps, durationInFrames: durationFrames(project),
      },
      inputProps: {project},
      ...encoding, scale, muted,
      videoBitrate: 'high', audioBitrate: 'high',
      outputTarget: 'arraybuffer', pageResponsiveness: 'high',
      // Use the built-in DOM composer. Native HTML-in-canvas is experimental
      // and can otherwise depend on Chrome flags or a very recent version.
      allowHtmlInCanvas: false,
      licenseKey: 'free-license', isProduction: import.meta.env.PROD,
      signal,
      onProgress: ({progress}) => {
        if (!signal.aborted) job.progress = Math.max(0.01, Math.min(0.99, progress));
      },
    });
    if (signal.aborted) return;
    const blob = await result.getBlob();
    if (signal.aborted) return;
    if (!blob.size) throw new Error('The video encoder produced an empty file.');
    job.url = URL.createObjectURL(blob);
    job.progress = 1;
    job.status = 'done';
  } catch (error) {
    if (!signal.aborted) {
      job.status = 'error';
      job.error = describeError(error);
    }
  } finally {
    controllers.delete(job.id);
    active = false;
    void renderNext();
  }
}

/** Starts a real render in this browser; uploaded assets must already be readable URLs. */
export function startBrowserRender(project: Project, quality: '720p' | '1080p'): {id: string} {
  if (!project.scenes.length || durationFrames(project) < 1) throw new Error('Add at least one scene before exporting.');
  if (quality !== '720p' && quality !== '1080p') throw new Error('Choose 720p or 1080p video quality.');
  if (queue.length >= 4) throw new Error('The export queue is full. Wait for an export to finish.');
  pruneCompletedJobs();
  const job: BrowserRenderJob = {id: crypto.randomUUID(), status: 'queued', progress: 0};
  const controller = new AbortController();
  jobs.set(job.id, job);
  controllers.set(job.id, controller);
  queue.push({job, project: structuredClone(project), quality, controller});
  void renderNext();
  return {id: job.id};
}

export function getBrowserRender(id: string): BrowserRenderJob {
  const job = jobs.get(id);
  if (!job) throw new Error('This export is no longer available. Start a new export.');
  return publicJob(job);
}

export function cancelBrowserRender(id: string): BrowserRenderJob {
  const job = jobs.get(id);
  if (!job) throw new Error('This export is no longer available.');
  if (finished.has(job.status)) return publicJob(job);
  job.status = 'cancelled';
  controllers.get(id)?.abort();
  queue = queue.filter(pending => pending.job.id !== id);
  controllers.delete(id);
  return publicJob(job);
}
