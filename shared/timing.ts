import type {Scene} from './types';

// Reserve a minimum for each scene, then distribute a fixed integer frame budget.
export function fitSceneDuration(scenes: Scene[], seconds: number, fps = 30): Scene[] {
  const minimum = Math.ceil(0.5 * fps);
  const total = Math.min(120 * fps, Math.max(5 * fps, scenes.length * minimum, Math.round(seconds * fps)));
  const remainder = total - scenes.length * minimum;
  const weightSum = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const portions = scenes.map(scene => remainder * scene.duration / weightSum);
  const frames = portions.map(portion => minimum + Math.floor(portion));
  const order = portions.map((portion, index) => ({index, fraction: portion % 1})).sort((a,b) => b.fraction-a.fraction);
  const missing = total-frames.reduce((sum, value) => sum+value, 0);
  for (let index=0; index<missing; index++) frames[order[index % order.length].index]++;
  return scenes.map((scene, index) => ({...scene, duration: frames[index]/fps}));
}
