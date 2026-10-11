import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {ZodError} from 'zod';
import {generateSchema, renderSchema, validationMessage} from './validation.mjs';
import {generateProject, ollamaStatus} from './generation.mjs';
import {MediaRegistry, MAX_UPLOAD_BYTES} from './media.mjs';
import {RenderQueue} from './render.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function isAllowedHost(host) {
  if (typeof host !== 'string') return false;
  return /^(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(host.toLowerCase());
}

export function isAllowedOrigin(origin, port) {
  if (!origin) return true; // Local command-line tools do not send an Origin header.
  const allowed = new Set([
    `http://127.0.0.1:${port}`, `http://localhost:${port}`,
    'http://127.0.0.1:5173', 'http://localhost:5173',
  ]);
  return allowed.has(origin);
}

export async function createApp({port = 3001, dataDirectory = path.join(rootDirectory, 'data'), ollamaUrl = 'http://127.0.0.1:11434', fetchImpl = fetch, browserExecutable} = {}) {
  const app = express();
  app.disable('x-powered-by');
  const mediaRegistry = new MediaRegistry(dataDirectory);
  const renderQueue = new RenderQueue({rootDirectory, dataDirectory, baseUrl: `http://127.0.0.1:${port}`, mediaRegistry, browserExecutable});
  await Promise.all([mediaRegistry.initialize(), renderQueue.initialize()]);
  app.locals.mediaRegistry = mediaRegistry;
  app.locals.renderQueue = renderQueue;

  app.use((request, response, next) => {
    if (!isAllowedHost(request.headers.host)) return response.status(403).json({error: 'This app only accepts requests from localhost.'});
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !isAllowedOrigin(request.headers.origin, port)) {
      return response.status(403).json({error: 'Requests from another website are not allowed. Open this app on localhost.'});
    }
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({limit: '256kb'}));

  app.get('/api/health', async (_request, response) => {
    const ollama = await ollamaStatus({url: ollamaUrl, fetchImpl});
    response.json({ok: true, version: '1.0.0', ollama: {...ollama, defaultModel: process.env.OLLAMA_MODEL || 'qwen2.5:3b'}, renderer: {browserConfigured: Boolean(browserExecutable), maxDuration: 120, maxConcurrentExports: 1}});
  });

  let generationActive = false;
  app.post('/api/generate', async (request, response) => {
    const input = generateSchema.parse(request.body && typeof request.body === 'object'
      ? {...request.body, model: request.body.model ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:3b'}
      : request.body);
    if (generationActive) return response.status(429).json({error: 'A storyboard is already being generated. Wait for it to finish.'});
    generationActive = true;
    try { response.json(await generateProject(input, {url: ollamaUrl, fetchImpl})); }
    finally { generationActive = false; }
  });

  const upload = multer({
    storage: multer.diskStorage({
      destination: mediaRegistry.uploadsDirectory,
      filename: (_request, _file, done) => done(null, `${randomUUID()}.upload`),
    }),
    // Busboy emits partsLimit at the limit itself. Keep the part budget above
    // the two expected parts; files and fields still enforce one of each.
    limits: {fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 1, parts: 3, fieldSize: 32},
  });
  app.post('/api/upload', upload.single('file'), async (request, response) => {
    response.status(201).json(await mediaRegistry.accept(request.file, request.body?.kind));
  });

  // Remotion serves its render bundle on another local port. Mediabunny fetches
  // uploads from this API, so allow read-only CORS from local render browsers.
  app.use('/media', (request, response, next) => {
    const origin = request.headers.origin;
    if (origin) {
      let local = false;
      try {
        const parsed = new URL(origin);
        local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.username && !parsed.password;
      } catch { /* Invalid origins are rejected. */ }
      if (!local) return response.status(403).json({error: 'Media is only available to local apps.'});
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Range');
      response.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    }
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    next();
  });
  app.get('/media/:filename', (request, response) => {
    const asset = mediaRegistry.findFilename(request.params.filename);
    if (!asset) return response.status(404).json({error: 'This media file is missing. Re-upload it.'});
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.sendFile(mediaRegistry.filePath(asset));
  });

  app.post('/api/render', (request, response) => {
    const {project, quality} = renderSchema.parse(request.body);
    response.status(202).json(renderQueue.enqueue(project, quality));
  });
  app.get('/api/render/:id', (request, response) => {
    const job = renderQueue.publicJob(renderQueue.jobs.get(request.params.id));
    if (!job) return response.status(404).json({error: 'Export not found. Exports from previous sessions are in data/exports.'});
    response.setHeader('Cache-Control', 'no-store');
    response.json(job);
  });
  app.delete('/api/render/:id', (request, response) => {
    const job = renderQueue.cancel(request.params.id);
    if (!job) return response.status(404).json({error: 'Export not found.'});
    response.json(job);
  });
  app.get('/exports/:filename', async (request, response) => {
    const {filename} = request.params;
    if (!/^[0-9a-f-]{36}\.mp4$/.test(filename)) return response.status(404).json({error: 'Export not found.'});
    const target = path.join(renderQueue.outputDirectory, filename);
    try { await fs.access(target); }
    catch { return response.status(404).json({error: 'Export not found.'}); }
    const job = renderQueue.jobs.get(filename.slice(0, -4));
    if (job && job.status !== 'done') return response.status(409).json({error: 'This export has not finished yet.'});
    response.download(target, 'motion-studio-video.mp4');
  });

  app.use('/api', (_request, response) => response.status(404).json({error: 'API endpoint not found.'}));
  const distDirectory = path.join(rootDirectory, 'dist');
  app.use(express.static(distDirectory));
  app.get('/{*path}', async (_request, response) => {
    try { await fs.access(path.join(distDirectory, 'index.html')); }
    catch { return response.status(404).send('Run npm run dev for development, or npm run build then npm start to open Motion Studio.'); }
    response.sendFile(path.join(distDirectory, 'index.html'));
  });

  app.use(async (error, request, response, _next) => {
    if (request.file?.path) await fs.rm(request.file.path, {force: true}).catch(() => {});
    if (response.headersSent) return;
    if (error instanceof ZodError) return response.status(400).json({error: validationMessage(error)});
    if (error instanceof multer.MulterError) {
      return response.status(400).json({error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 200 MB or smaller.' : 'Upload one file with the file field and a kind of audio or video.'});
    }
    if (error.type === 'entity.too.large') return response.status(413).json({error: 'The project is too large.'});
    if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({error: 'Send a valid JSON request.'});
    const status = error.status && Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    response.status(status).json({error: status >= 500 ? 'The local server could not complete this request. Check the terminal for details.' : error.message});
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const parsedUrl = new URL(ollamaUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsedUrl.hostname) || parsedUrl.protocol !== 'http:' || parsedUrl.username || parsedUrl.password) {
    throw new Error('OLLAMA_BASE_URL must point to your local Ollama server, such as http://127.0.0.1:11434.');
  }
  const app = await createApp({port, ollamaUrl, browserExecutable: process.env.CHROME_EXECUTABLE || undefined});
  app.listen(port, '127.0.0.1', () => console.log(`Motion Studio API: http://127.0.0.1:${port} — media and renders stay on this computer.`));
}
