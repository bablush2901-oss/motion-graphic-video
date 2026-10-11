import type { Project, SceneType, Theme } from './types';
export const THEME_COLORS: Record<Theme, {accent: string; background: string; foreground: string; muted: string}> = {
  ember: {accent: '#ff7852', background: '#161616', foreground: '#f7f4ef', muted: '#a7a29c'},
  electric: {accent: '#a592ff', background: '#121020', foreground: '#f5f1ff', muted: '#9d96b2'},
  mint: {accent: '#a6edc7', background: '#0e201b', foreground: '#effcf5', muted: '#8ba99b'},
  minimal: {accent: '#2768ff', background: '#f0eee8', foreground: '#1c1c1b', muted: '#77766f'},
};
export const SCENE_LABELS: Record<SceneType, string> = {title: 'Opening', kinetic: 'Kinetic type', stats: 'Big number', steps: 'Key points', quote: 'Quote', outro: 'Closing'};
export const DEMO_PROJECT: Project = {
  version: 1,
  title: 'Make your next big move',
  prompt: 'Create a bold launch video about turning ideas into action. Use warm orange, punchy typography, and a clean editorial style.',
  script: '', theme: 'ember', aspectRatio: '16:9', fps: 30,
  audioVolume: 0.7, narratorVolume: 1, narratorPosition: 'right', showNarrator: true,
  scenes: [
    {id: 'opening', type: 'title', title: 'Ideas deserve\nmotion.', subtitle: 'A little spark. A big possibility.', duration: 5, items: [], value: '', narration: 'Every great idea starts with a little spark.'},
    {id: 'momentum', type: 'kinetic', title: 'Make your\nnext big move.', subtitle: 'FROM WHAT IF TO WHAT’S NEXT', duration: 5, items: [], value: '', narration: 'Turn what if into what comes next.'},
    {id: 'steps', type: 'steps', title: 'Less friction.\nMore creation.', subtitle: 'YOUR IDEA, IN THREE SIMPLE STEPS', duration: 5, items: ['Write your idea', 'Find your rhythm', 'Make it move'], value: '', narration: 'Write your idea, find your rhythm, and make it move.'},
    {id: 'closing', type: 'outro', title: 'Your story.\nSet in motion.', subtitle: 'LET’S MAKE SOMETHING THAT MOVES.', duration: 5, items: [], value: '', narration: 'Your story deserves to be seen. Set it in motion.'},
  ],
};
