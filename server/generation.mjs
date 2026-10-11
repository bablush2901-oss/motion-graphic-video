import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {FPS, generateSchema, projectSchema} from './validation.mjs';

const TYPES = ['title', 'kinetic', 'stats', 'steps', 'quote', 'outro'];
const modelStoryboardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  scenes: z.array(z.object({
    type: z.enum(TYPES),
    title: z.string().max(180),
    subtitle: z.string().max(240).default(''),
    duration: z.number().finite().positive().max(120).default(5),
    items: z.array(z.string().max(500)).max(6).default([]),
    value: z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(100)).default(''),
    narration: z.string().max(30000).default(''),
  }).strict()).min(1).max(12),
}).strict();

const storyboardJsonSchema = {
  type: 'object', additionalProperties: false, required: ['title', 'scenes'],
  properties: {
    title: {type: 'string'},
    scenes: {type: 'array', minItems: 1, maxItems: 12, items: {
      type: 'object', additionalProperties: false,
      required: ['type', 'title', 'subtitle', 'duration', 'items', 'value', 'narration'],
      properties: {
        type: {type: 'string', enum: TYPES}, title: {type: 'string'}, subtitle: {type: 'string'},
        duration: {type: 'number'}, items: {type: 'array', items: {type: 'string'}, maxItems: 6},
        value: {type: 'string'}, narration: {type: 'string'},
      },
    }},
  },
};

function concise(value, maxWords = 9, maxCharacters = 120) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').slice(0, maxWords).join(' ');
  return words.length > maxCharacters ? `${words.slice(0, maxCharacters - 1).trimEnd()}…` : words;
}

/** Divide text without dropping source sentences, including an unpunctuated script. */
export function splitScript(script, count) {
  if (!script.trim()) return Array.from({length: count}, () => '');
  const words = script.trim().split(/\s+/);
  return Array.from({length: count}, (_, index) => words.slice(
    Math.round(index * words.length / count),
    Math.round((index + 1) * words.length / count),
  ).join(' '));
}

/** Allocate integer frames so the sum is exactly the requested duration. */
export function fitDuration(scenes, duration) {
  const total = Math.round(duration * FPS);
  const minimum = 15;
  if (!scenes.length || scenes.length * minimum > total) throw new Error('Too many scenes for the requested duration.');
  const available = total - scenes.length * minimum;
  const weights = scenes.map((scene) => Math.max(0.001, scene.duration || 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const portions = weights.map((weight) => available * weight / sum);
  const frames = portions.map((portion) => minimum + Math.floor(portion));
  let remaining = total - frames.reduce((a, b) => a + b, 0);
  const order = portions.map((portion, index) => ({index, fraction: portion % 1}))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; remaining > 0; index++, remaining--) frames[order[index % order.length].index]++;
  return scenes.map((scene, index) => ({...scene, duration: frames[index] / FPS}));
}

function makeProject(input, storyboard) {
  let scenes = storyboard.scenes.map((scene) => ({...scene, id: randomUUID()}));
  // The provided script is authoritative. Do not let a model replace it with invented narration.
  if (input.script) {
    const parts = splitScript(input.script, scenes.length);
    scenes = scenes.map((scene, index) => ({...scene, narration: parts[index]}));
  }
  return projectSchema.parse({
    version: 1, title: storyboard.title, prompt: input.prompt, script: input.script,
    theme: input.theme, aspectRatio: input.aspectRatio, fps: FPS,
    scenes: fitDuration(scenes, input.duration),
    audioVolume: 0.7, narratorVolume: 1, narratorPosition: 'right', showNarrator: true,
  });
}

export function templateStoryboard(rawInput) {
  const input = generateSchema.parse(rawInput);
  const source = input.script || input.prompt;
  const words = source.split(/\s+/).length;
  const count = Math.min(8, Math.max(2, Math.round(input.duration / 5)), Math.max(2, Math.ceil(words / 12)));
  const chunks = splitScript(source, count);
  const topic = concise(input.script || input.prompt.replace(/^(?:please\s+)?(?:create|make|generate|design)\s+(?:a\s+)?(?:\w+\s+){0,3}(?:video|motion graphic(?:s)?)\s+(?:about|for|on)\s+/i, ''), 8, 100) || 'Your story in motion';
  const scenes = chunks.map((chunk, index) => {
    const type = index === 0 ? 'title' : index === count - 1 ? 'outro' : index % 3 === 0 ? 'steps' : 'kinetic';
    return {
      type, title: concise(chunk || topic, 10, 120),
      subtitle: index === 0 ? 'YOUR STORY, SET IN MOTION' : index === count - 1 ? 'KEEP THE MOMENTUM GOING' : '',
      duration: 5, items: type === 'steps' ? chunk.split(/[,;]|\.\s/).filter(Boolean).slice(0, 3).map((item) => concise(item, 8, 90)) : [],
      value: '', narration: chunk,
    };
  });
  return makeProject(input, {title: topic, scenes});
}

export async function ollamaStatus({url = 'http://127.0.0.1:11434', fetchImpl = fetch} = {}) {
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/tags`, {signal: AbortSignal.timeout(3000)});
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    const body = await response.json();
    if (!Array.isArray(body.models)) throw new Error('Unexpected Ollama response.');
    return {available: true, models: body.models.map((model) => model.name).filter((name) => typeof name === 'string')};
  } catch {
    return {available: false, models: []};
  }
}

export async function generateProject(rawInput, {url = 'http://127.0.0.1:11434', fetchImpl = fetch, timeoutMs = 180000} = {}) {
  const input = generateSchema.parse(rawInput);
  if (input.provider === 'template') return {project: templateStoryboard(input), source: 'template'};
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: input.model, stream: false, format: storyboardJsonSchema,
        options: {temperature: 0.25, num_predict: 3500},
        messages: [
          {role: 'system', content: 'You design elegant, readable motion-graphics storyboards. Return only JSON matching the schema. Use 2 to 8 scenes with short visible titles (at most 10 words), restrained subtitles, and optional lists of 2 to 4 short items. Choose type from title, kinetic, stats, steps, quote, outro. Use title first and outro last. Each scene needs duration in seconds and narration. Preserve the provided script as the source of truth; do not invent numeric claims, quotes, facts, or endorsements. If there is no script, create a coherent original narrative guided by the prompt. Use stats only for a number explicitly in the input. Never return code, HTML, JavaScript, URLs, commands, or instructions to execute. Text is rendered as plain text. Keep all text in the language of the input.'},
          {role: 'user', content: JSON.stringify({prompt: input.prompt, script: input.script, durationSeconds: input.duration, theme: input.theme, aspectRatio: input.aspectRatio})},
        ],
      }),
    });
    if (!response.ok) throw new Error(response.status === 404 ? 'The selected Ollama model is not installed.' : `Ollama returned HTTP ${response.status}.`);
    const body = await response.json();
    const content = body?.message?.content;
    if (typeof content !== 'string' || content.length > 80000) throw new Error('Ollama did not return a valid storyboard.');
    const storyboard = modelStoryboardSchema.parse(JSON.parse(content));
    return {project: makeProject(input, storyboard), source: 'ollama'};
  } catch (error) {
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'Ollama took too long to respond.'
      : error?.message?.includes('not installed') ? error.message
      : 'Ollama is unavailable or returned an invalid storyboard.';
    return {
      project: templateStoryboard(input), source: 'template',
      warning: `${reason} Created a local template storyboard instead. Start Ollama and install the selected model to use AI generation.`,
    };
  }
}
