export type SceneType = 'title' | 'kinetic' | 'stats' | 'steps' | 'quote' | 'outro';
export type Theme = 'ember' | 'electric' | 'mint' | 'minimal';
export type AspectRatio = '16:9' | '9:16' | '1:1';
export interface Scene {
  id: string;
  type: SceneType;
  title: string;
  subtitle: string;
  duration: number;
  items: string[];
  value: string;
  narration: string;
}
export interface MediaAsset {
  id: string;
  name: string;
  url: string;
  kind: 'audio' | 'video';
  duration?: number;
}
export interface Project {
  version: 1;
  title: string;
  prompt: string;
  script: string;
  theme: Theme;
  aspectRatio: AspectRatio;
  fps: number;
  scenes: Scene[];
  audio?: MediaAsset;
  narrator?: MediaAsset;
  audioVolume: number;
  narratorVolume: number;
  narratorPosition: 'left' | 'right';
  showNarrator: boolean;
}
export interface CompositionProps extends Record<string, unknown> { project: Project }
export const dimensionsFor = (ratio: AspectRatio) => ratio === '9:16' ? {width: 1080, height: 1920} : ratio === '1:1' ? {width: 1080, height: 1080} : {width: 1920, height: 1080};
export const durationFrames = (project: Project) => project.scenes.reduce((sum, scene) => sum + Math.round(scene.duration * project.fps), 0);
