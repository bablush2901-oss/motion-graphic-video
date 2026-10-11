import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateProject, templateStoryboard, fitDuration} from './generation.mjs';
import {generateSchema, projectSchema} from './validation.mjs';
import {MediaRegistry, validateMediaHeader, mediaExtension} from './media.mjs';
import {createApp, isAllowedHost, isAllowedOrigin} from './index.mjs';
import {exportProject, RenderQueue} from './render.mjs';

const input = {prompt: 'Create a launch video about a community garden that brings people together.', duration: 20, provider: 'template'};
const offline = async () => { throw new Error('connection refused'); };

test('generation rejects empty inputs, invalid duration, and unknown providers', () => {
  for (const invalid of [{}, {...input, duration: 4}, {...input, duration: 121}, {...input, duration: Infinity}, {...input, provider: 'remote'}, {...input, model: 'model; exec something'}]) {
    assert.equal(generateSchema.safeParse(invalid).success, false);
  }
});

test('offline Ollama fallback is explicit and matches every requested frame', async () => {
  for (const duration of [5, 5.5, 7.03, 20, 120]) {
    const result = await generateProject({...input, duration, provider: 'ollama'}, {fetchImpl: offline});
    assert.equal(result.source, 'template');
    assert.match(result.warning, /Ollama/);
    assert.ok(projectSchema.safeParse(result.project).success);
    assert.equal(result.project.scenes.reduce((sum, scene) => sum + Math.round(scene.duration * 30), 0), Math.round(duration * 30));
    assert.ok(result.project.scenes.every((scene) => scene.duration >= 0.5));
  }
});

test('the full supplied script survives template generation and AI narration changes', async () => {
  const script = 'First we plant the seeds. Then we water them. The neighbours share the harvest. This is how a community grows.';
  const template = templateStoryboard({...input, script});
  assert.equal(template.scenes.map((scene) => scene.narration).join(' '), script);
  const storyboard = {
    title: 'Growing together',
    scenes: [{type: 'title', title: 'Plant a seed', subtitle: '', duration: 4, items: [], value: '', narration: 'Invented narration'}, {type: 'outro', title: 'Grow together', subtitle: '', duration: 4, items: [], value: '', narration: 'Also invented'}],
  };
  let calledBody;
  const fetchImpl = async (_url, options) => {
    calledBody = JSON.parse(options.body);
    return {ok: true, json: async () => ({message: {content: JSON.stringify(storyboard)}})};
  };
  const result = await generateProject({...input, script, provider: 'ollama'}, {fetchImpl});
  assert.equal(result.source, 'ollama');
  assert.equal(result.project.scenes.map((scene) => scene.narration).join(' '), script);
  assert.equal(calledBody.format.type, 'object');
  assert.equal(calledBody.stream, false);
});

test('invalid model output falls back safely and cannot become executable code', async () => {
  const result = await generateProject({...input, provider: 'ollama'}, {
    fetchImpl: async () => ({ok: true, json: async () => ({message: {content: '<script>bad()</script>'}})}),
  });
  assert.equal(result.source, 'template');
  assert.match(result.warning, /invalid storyboard/);
  assert.throws(() => fitDuration(Array.from({length: 12}, () => ({duration: 5})), 5));
});

test('render validation bounds scene count, duration, volume and media origins', () => {
  const project = templateStoryboard(input);
  assert.equal(projectSchema.safeParse({...project, scenes: project.scenes.map((scene) => ({...scene, duration: 120}))}).success, false);
  assert.equal(projectSchema.safeParse({...project, audioVolume: 2}).success, false);
  assert.equal(projectSchema.safeParse({...project, fps: 60}).success, false);
  assert.equal(projectSchema.safeParse({...project, scenes: [project.scenes[0], project.scenes[0]]}).success, false);
  assert.equal(projectSchema.safeParse({...project, audio: {id: 'ea0c8788-9b5a-40c5-8831-a0d5f791ba43', name: 'music.mp3', kind: 'audio', url: 'https://example.com/music.mp3'}}).success, false);
});

test('media validation checks file headers and expected kind', () => {
  assert.equal(validateMediaHeader('wav', Buffer.from('RIFF0000WAVEfmt ')), true);
  assert.equal(validateMediaHeader('mp4', Buffer.from('0000ftypisom0000')), true);
  assert.equal(validateMediaHeader('mp3', Buffer.from('<script>alert()</script>')), false);
  assert.equal(validateMediaHeader('webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), true);
  assert.throws(() => mediaExtension('image.png', 'video'));
  assert.throws(() => mediaExtension('music.mp3', 'video'));
});

test('only known uploads become absolute renderer URLs', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-media-test-'));
  context.after(() => fs.rm(directory, {recursive: true, force: true}));
  const registry = new MediaRegistry(directory);
  await registry.initialize();
  const temporary = path.join(registry.uploadsDirectory, 'file.upload');
  await fs.writeFile(temporary, Buffer.from('RIFF0000WAVEfmt '));
  const asset = await registry.accept({path: temporary, originalname: 'voice.wav', mimetype: 'audio/wav', size: 16}, 'audio');
  const project = {...templateStoryboard(input), audio: asset};
  const exported = exportProject(project, 'http://127.0.0.1:3001', registry);
  assert.equal(exported.audio.url, `http://127.0.0.1:3001${asset.url}`);
  assert.equal(project.audio.url, asset.url);
  assert.throws(() => exportProject({...project, audio: {...asset, url: '/media/ea0c8788-9b5a-40c5-8831-a0d5f791ba43.mp3'}}, 'http://127.0.0.1:3001', registry));
  const restored = new MediaRegistry(directory);
  await restored.initialize();
  assert.equal(restored.assets.get(asset.id).url, asset.url);
});

test('localhost protection rejects foreign sites and DNS rebinding hostnames', () => {
  assert.equal(isAllowedHost('127.0.0.1:3001'), true);
  assert.equal(isAllowedHost('localhost:3001'), true);
  assert.equal(isAllowedHost('localhost.evil.test:3001'), false);
  assert.equal(isAllowedOrigin('https://foreign.example', 3001), false);
  assert.equal(isAllowedOrigin('http://127.0.0.1:5173', 3001), true);
  assert.equal(isAllowedOrigin('null', 3001), false);
});

test('HTTP API exposes offline health, validates generation and blocks cross-origin writes', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'motion-api-test-'));
  const app = await createApp({dataDirectory: directory, fetchImpl: offline});
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, {recursive: true, force: true});
  });
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.ollama.available, false);
  const malformed = await fetch(`${base}/api/generate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...input, duration: -2})});
  assert.equal(malformed.status, 400);
  const blocked = await fetch(`${base}/api/generate`, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://evil.example'}, body: JSON.stringify(input)});
  assert.equal(blocked.status, 403);
  const generated = await fetch(`${base}/api/generate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...input, provider: 'ollama'})});
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).source, 'template');
  const form = new FormData();
  form.append('kind', 'audio');
  form.append('file', new Blob(['RIFF0000WAVEfmt '], {type: 'audio/wav'}), 'voice.wav');
  const uploaded = await fetch(`${base}/api/upload`, {method: 'POST', body: form});
  const asset = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(asset));
  assert.equal((await fetch(`${base}${asset.url}`)).status, 200);
  const rendererMedia = await fetch(`${base}${asset.url}`, {headers: {Origin: 'http://localhost:39001', Range: 'bytes=0-7'}});
  assert.equal(rendererMedia.status, 206);
  assert.equal(rendererMedia.headers.get('Access-Control-Allow-Origin'), 'http://localhost:39001');
  assert.equal((await fetch(`${base}${asset.url}`, {headers: {Origin: 'https://foreign.example'}})).status, 403);
  const invalidForm = new FormData();
  invalidForm.append('kind', 'video');
  invalidForm.append('file', new Blob(['This is not a video'], {type: 'video/mp4'}), 'fake.mp4');
  assert.equal((await fetch(`${base}/api/upload`, {method: 'POST', body: invalidForm})).status, 400);
});

test('the export queue cancels a waiting job without starting another renderer', async () => {
  const queue = new RenderQueue({rootDirectory: '.', dataDirectory: '.', baseUrl: 'http://127.0.0.1:3001', mediaRegistry: {assertKnown() {}}});
  queue.active = true;
  const {id} = queue.enqueue(templateStoryboard(input), '720p');
  assert.equal(queue.publicJob(queue.jobs.get(id)).status, 'queued');
  assert.equal(queue.cancel(id).status, 'cancelled');
  assert.equal(queue.queue.length, 0);
  assert.equal(queue.cancel('missing'), undefined);
});
