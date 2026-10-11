import {z} from 'zod';

export const FPS = 30;
export const MAX_DURATION = 120;
const text = (max) => z.string().max(max);
const theme = z.enum(['ember', 'electric', 'mint', 'minimal']);
const aspectRatio = z.enum(['16:9', '9:16', '1:1']);

export const generateSchema = z.object({
  prompt: text(6000).trim().default(''),
  script: text(30000).trim().default(''),
  theme: theme.default('ember'),
  aspectRatio: aspectRatio.default('16:9'),
  duration: z.number().finite().min(5).max(MAX_DURATION).default(20),
  provider: z.enum(['ollama', 'template']).default('ollama'),
  model: z.string().trim().min(1).max(150).regex(/^[a-zA-Z0-9_.:/-]+$/).default('qwen2.5:3b'),
}).strict().refine((input) => input.prompt.length > 0 || input.script.length > 0, {
  message: 'Enter a prompt or a script to create a video.', path: ['prompt'],
});

export const sceneSchema = z.object({
  id: text(80).min(1),
  type: z.enum(['title', 'kinetic', 'stats', 'steps', 'quote', 'outro']),
  title: text(180),
  subtitle: text(240),
  duration: z.number().finite().min(0.5).max(MAX_DURATION),
  items: z.array(text(500)).max(6),
  value: text(100),
  narration: text(30000),
}).strict();

export const mediaSchema = z.object({
  id: z.string().uuid(),
  name: text(255).min(1),
  url: z.string().regex(/^\/media\/[0-9a-f-]{36}\.(mp3|wav|m4a|aac|ogg|flac|mp4|webm)$/),
  kind: z.enum(['audio', 'video']),
  duration: z.number().finite().positive().max(7200).optional(),
}).strict();

export const projectSchema = z.object({
  version: z.literal(1),
  title: text(200).min(1),
  prompt: text(6000),
  script: text(30000),
  theme,
  aspectRatio,
  fps: z.literal(FPS),
  scenes: z.array(sceneSchema).min(1).max(12),
  audio: mediaSchema.optional(),
  narrator: mediaSchema.optional(),
  audioVolume: z.number().finite().min(0).max(1),
  narratorVolume: z.number().finite().min(0).max(1),
  narratorPosition: z.enum(['left', 'right']),
  showNarrator: z.boolean(),
}).strict().superRefine((project, ctx) => {
  const frames = project.scenes.reduce((sum, scene) => sum + Math.round(scene.duration * FPS), 0);
  if (frames < 5 * FPS || frames > MAX_DURATION * FPS) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['scenes'], message: 'Total video duration must be between 5 and 120 seconds.'});
  }
  if (new Set(project.scenes.map((scene) => scene.id)).size !== project.scenes.length) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['scenes'], message: 'Scene IDs must be unique.'});
  }
  if (project.audio && project.audio.kind !== 'audio') {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['audio'], message: 'The soundtrack must be an audio file.'});
  }
  if (project.narrator && project.narrator.kind !== 'video') {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['narrator'], message: 'The narrator must be a video file.'});
  }
});

export const renderSchema = z.object({
  project: projectSchema,
  quality: z.enum(['720p', '1080p']).default('720p'),
}).strict();

export function validationMessage(error) {
  return error.issues?.map((issue) => `${issue.path.join('.') || 'Request'}: ${issue.message}`).join(' ') || 'Invalid request.';
}
