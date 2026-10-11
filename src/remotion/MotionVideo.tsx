import type { CSSProperties, ReactNode } from 'react';
import { Audio, Video } from '@remotion/media';
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { CompositionProps, Project, Scene } from '../../shared/types';
import { SCENE_LABELS, THEME_COLORS } from '../../shared/defaults';

const FONT = 'Arial, Helvetica, sans-serif';
const clamp = { extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const };
const ease = Easing.bezier(0.16, 1, 0.3, 1);
type Colors = (typeof THEME_COLORS)['ember'];
type Layout = { x: number; y: number; width: number; height: number; margin: number; compact: boolean; portrait: boolean; canvasWidth: number; canvasHeight: number };
type SceneProps = { scene: Scene; project: Project; index: number; colors: Colors; layout: Layout };

// Text is fitted before rendering, so a long prompt remains within the safe area.
const weight = (text: string) => [...text].reduce((sum, character) => sum + (/[MW@%]/.test(character) ? 0.9 : /[ilI.,'! ]/.test(character) ? 0.28 : 0.57), 0);
const wrap = (text: string, maxWeight: number) => text.split('\n').flatMap((line) => {
  const words = line.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current && weight(`${current} ${word}`) > maxWeight) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
});
const fittedText = (text: string, width: number, maxSize: number, maxHeight: number) => {
  let size = maxSize;
  let lines = wrap(text, width / size);
  for (let attempt = 0; attempt < 18; attempt++) {
    const widest = Math.max(1, ...lines.map(weight));
    if (widest * size <= width && lines.length * size * 1.07 <= maxHeight) break;
    size *= 0.9;
    lines = wrap(text, width / size);
  }
  return { size, lines };
};

const getLayout = (project: Project, width: number, height: number): Layout => {
  const portrait = height > width;
  const compact = width <= height;
  const margin = Math.min(width, height) * 0.083;
  const hasNarrator = Boolean(project.narrator && project.showNarrator);
  const narrationWidth = hasNarrator && !compact ? width * 0.27 + margin * 0.6 : 0;
  const narrationHeight = hasNarrator && compact ? height * (portrait ? 0.29 : 0.32) : 0;
  return {
    x: margin + (hasNarrator && !compact && project.narratorPosition === 'left' ? narrationWidth : 0),
    y: margin + height * (portrait ? 0.08 : 0.1),
    width: width - margin * 2 - narrationWidth,
    height: height - margin * 2 - height * 0.23 - narrationHeight,
    margin,
    compact,
    portrait,
    canvasWidth: width,
    canvasHeight: height,
  };
};

const Orbit = ({ colors, size = 690, opacity = 1 }: { colors: Colors; size?: number; opacity?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = spring({ frame: frame - Math.round(0.12 * fps), fps, config: { damping: 80, stiffness: 105 } });
  const angle = (frame / fps) * 9;
  return (
    <div style={{ width: size, height: size, position: 'relative', opacity, scale: 0.7 + reveal * 0.3, rotate: `${angle}deg` }}>
      <svg viewBox="0 0 700 700" width="100%" height="100%" fill="none" style={{ overflow: 'visible' }}>
        <ellipse cx="350" cy="350" rx="298" ry="135" stroke={colors.accent} strokeWidth="2.2" transform="rotate(-32 350 350)" />
        <ellipse cx="350" cy="350" rx="298" ry="135" stroke={colors.accent} strokeWidth="2.2" transform="rotate(32 350 350)" />
        <ellipse cx="350" cy="350" rx="298" ry="135" stroke={colors.accent} strokeWidth="2.2" transform="rotate(90 350 350)" />
        <circle cx="350" cy="350" r="71" fill={colors.accent} />
        <circle cx="583" cy="228" r="12" fill={colors.foreground} />
        <circle cx="221" cy="593" r="7" fill={colors.accent} />
      </svg>
    </div>
  );
};

const LineTitle = ({ text, colors, width, height, maxSize, accentLast = true, stagger = 0.12 }: { text: string; colors: Colors; width: number; height: number; maxSize: number; accentLast?: boolean; stagger?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, size } = fittedText(text, width, maxSize, height);
  return (
    <div style={{ fontSize: size, fontWeight: 750, lineHeight: 1.04, letterSpacing: '-0.067em', color: colors.foreground }}>
      {lines.map((line, index) => (
        <div key={`${line}-${index}`} style={{ overflow: 'hidden', padding: '0.035em 0.09em 0.085em 0', marginBottom: '-0.085em' }}>
          <div style={{
            translate: `0 ${interpolate(frame, [index * stagger * fps, (0.75 + index * stagger) * fps], [size * 1.1, 0], { ...clamp, easing: ease })}px`,
            opacity: interpolate(frame, [index * stagger * fps, (0.45 + index * stagger) * fps], [0, 1], clamp),
            color: accentLast && index === lines.length - 1 ? colors.accent : colors.foreground,
            overflowWrap: 'anywhere',
          }}>{line}</div>
        </div>
      ))}
    </div>
  );
};

const Subtitle = ({ children, colors, width, delay = 0.5, style, maxHeight = 120 }: { children: ReactNode; colors: Colors; width: number; delay?: number; style?: CSSProperties; maxHeight?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fit = typeof children === 'string' ? fittedText(children, width, typeof style?.fontSize === 'number' ? style.fontSize : 28, maxHeight / 1.35) : undefined;
  return <div style={{ fontSize: 28, fontWeight: 400, lineHeight: 1.45, color: colors.muted, width, opacity: interpolate(frame, [delay * fps, (delay + 0.5) * fps], [0, 1], clamp), translate: `0 ${interpolate(frame, [delay * fps, (delay + 0.6) * fps], [15, 0], { ...clamp, easing: ease })}px`, ...style, ...(fit ? { fontSize: fit.size, whiteSpace: 'pre-line' as const } : {}) }}>{fit ? fit.lines.join('\n') : children}</div>;
};

const TitleScene = ({ scene, project, colors, layout }: SceneProps) => {
  const { width, height, x, y, compact, canvasWidth, canvasHeight } = layout;
  const hasNarrator = Boolean(project.narrator && project.showNarrator);
  const titleWidth = compact || hasNarrator ? width : width * 0.67;
  const orbitSize = compact ? canvasWidth * 0.62 : canvasHeight * 0.65;
  return <>
    {!hasNarrator && <div style={{ position: 'absolute', left: compact ? canvasWidth * 0.42 : canvasWidth * 0.6, top: compact ? canvasHeight * 0.46 : canvasHeight * 0.19 }}><Orbit colors={colors} size={orbitSize} opacity={compact ? 0.23 : 0.85} /></div>}
    <div style={{ position: 'absolute', left: x, top: y + height * 0.15, width: titleWidth }}>
      <LineTitle text={scene.title} colors={colors} width={titleWidth} height={height * 0.65} maxSize={compact ? 122 : 168} />
      {scene.subtitle && <Subtitle colors={colors} width={titleWidth} maxHeight={height * 0.2} style={{ marginTop: Math.min(42, height * 0.08) }}>{scene.subtitle}</Subtitle>}
    </div>
  </>;
};

const KineticScene = ({ scene, colors, layout }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, width, height, compact } = layout;
  const shift = interpolate(frame, [0, scene.duration * fps], [0, -70], clamp);
  return <>
    <div style={{ position: 'absolute', left: x, top: y + height * 0.12, width }}>
      {scene.subtitle && <Subtitle colors={colors} width={width} delay={0.1} style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.14em', marginBottom: 42 }}>{scene.subtitle}</Subtitle>}
      <LineTitle text={scene.title} colors={colors} width={width} height={height * 0.67} maxSize={compact ? 138 : 186} stagger={0.18} />
    </div>
    <div style={{ position: 'absolute', left: x + width * 0.6, top: y + height * 0.8, translate: `${shift}px 0`, width: width * 0.34, height: 20, opacity: 0.8 }}>
      <svg viewBox="0 0 500 30" fill="none" width="100%" height="100%"><path d="M0 15H494M478 1L494 15L478 29" stroke={colors.accent} strokeWidth="3" /></svg>
    </div>
  </>;
};

// Only animate a numeric value actually supplied by the scene. Units and labels are preserved.
const animatedValue = (value: string, progress: number) => {
  const match = value.match(/[-+]?\d[\d,]*(?:\.\d+)?/);
  if (!match) return value;
  const number = Number(match[0].replaceAll(',', ''));
  if (!Number.isFinite(number)) return value;
  const decimals = (match[0].split('.')[1] || '').length;
  const raw = (number * progress).toFixed(decimals);
  const display = match[0].includes(',') ? Number(raw).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : raw;
  return value.replace(match[0], display);
};

const StatsScene = ({ scene, colors, layout }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, width, height, compact } = layout;
  const progress = interpolate(frame, [0.2 * fps, 1.75 * fps], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const number = animatedValue(scene.value, progress);
  const size = fittedText(number, width, compact ? 222 : 300, height * 0.37).size;
  return <div style={{ position: 'absolute', left: x, top: y + height * 0.04, width }}>
    <LineTitle text={scene.title} colors={colors} width={width} height={height * 0.23} maxSize={compact ? 78 : 99} accentLast={false} />
    {scene.value && <div style={{ fontSize: size, fontWeight: 750, letterSpacing: '-0.065em', color: colors.accent, lineHeight: 1.07, marginTop: Math.min(28, height * 0.04), fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', opacity: interpolate(frame, [0.15 * fps, 0.5 * fps], [0, 1], clamp) }}>{number}</div>}
    <div style={{ width: `${progress * 100}%`, height: 3, background: colors.accent, marginTop: Math.min(27, height * 0.04), marginBottom: Math.min(29, height * 0.04) }} />
    {scene.subtitle && <Subtitle colors={colors} width={width} delay={0.8} maxHeight={height * 0.12}>{scene.subtitle}</Subtitle>}
    {scene.items.length > 0 && <Subtitle colors={colors} width={width} delay={1.1} maxHeight={height * 0.1} style={{ fontSize: 23, marginTop: Math.min(15, height * 0.03) }}>{scene.items.join('  ·  ')}</Subtitle>}
  </div>;
};

const StepsScene = ({ scene, colors, layout }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, width, height, compact } = layout;
  const items = scene.items.length ? scene.items : (scene.subtitle ? [scene.subtitle] : []);
  const horizontal = !compact && width > 1250 && items.length <= 3;
  const titleHeight = height * (horizontal ? 0.48 : 0.34);
  const fontSize = compact ? 73 : 99;
  const rowHeight = Math.min(105, Math.max(20, (height - titleHeight - 44) / Math.max(1, items.length)));
  return <div style={{ position: 'absolute', left: x, top: y, width }}>
    <LineTitle text={scene.title} colors={colors} width={width} height={titleHeight} maxSize={fontSize} />
    {scene.subtitle && scene.items.length > 0 && horizontal && <Subtitle colors={colors} width={width} delay={0.3} style={{ fontSize: 20, letterSpacing: '0.12em', marginTop: 24 }}>{scene.subtitle}</Subtitle>}
    <div style={{ marginTop: horizontal ? 65 : 44, display: 'flex', flexDirection: horizontal ? 'row' : 'column', gap: horizontal ? 44 : 0 }}>
      {items.map((item, index) => {
        const entrance = spring({ frame: frame - Math.round((0.35 + index * 0.22) * fps), fps, config: { damping: 24, stiffness: 125 } });
        const itemFit = fittedText(item, horizontal ? (width - 44 * (items.length - 1)) / items.length : width - 75, horizontal ? 34 : 31, horizontal ? 100 : rowHeight - 12);
        return <div key={`${item}-${index}`} style={{ flex: horizontal ? 1 : undefined, minHeight: horizontal ? 148 : rowHeight, display: 'flex', flexDirection: horizontal ? 'column' : 'row', alignItems: horizontal ? 'flex-start' : 'center', gap: horizontal ? 24 : 26, borderTop: horizontal ? `1px solid ${colors.muted}66` : undefined, borderBottom: horizontal ? undefined : `1px solid ${colors.muted}44`, paddingTop: horizontal ? 25 : 0, opacity: interpolate(entrance, [0, 1], [0, 1], clamp), translate: `0 ${30 * (1 - entrance)}px` }}>
          <span style={{ color: colors.accent, fontSize: horizontal ? 26 : 23, fontWeight: 500, letterSpacing: '-0.02em', flexShrink: 0 }}>{String(index + 1).padStart(2, '0')}</span>
          <span style={{ color: colors.foreground, fontSize: itemFit.size, lineHeight: 1.07, fontWeight: 500, letterSpacing: '-0.035em', overflowWrap: 'anywhere', minWidth: 0, whiteSpace: 'pre-line' }}>{itemFit.lines.join('\n')}</span>
        </div>;
      })}
    </div>
  </div>;
};

const QuoteScene = ({ scene, colors, layout }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, width, height, compact } = layout;
  const quoteSize = Math.min(compact ? 220 : 260, height * 0.28);
  return <div style={{ position: 'absolute', left: x, top: y - 20, width }}>
    <div style={{ fontSize: quoteSize, lineHeight: 0.7, height: quoteSize * 0.75, color: colors.accent, fontWeight: 800, opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], clamp) }}>“</div>
    <LineTitle text={scene.title} colors={colors} width={width} height={height * 0.57} maxSize={compact ? 94 : 120} accentLast={false} />
    {scene.subtitle && <Subtitle colors={colors} width={width} maxHeight={height * 0.17} style={{ marginTop: Math.min(40, height * 0.08), color: colors.accent }}>{`— ${scene.subtitle}`}</Subtitle>}
  </div>;
};

const OutroScene = ({ scene, colors, layout }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y, width, height, compact } = layout;
  const enter = spring({ frame: frame - Math.round(0.2 * fps), fps, config: { damping: 20, stiffness: 95 } });
  const badgeSize = Math.min(compact ? 104 : 130, height * 0.18);
  return <div style={{ position: 'absolute', left: x, top: y + height * 0.04, width }}>
    <div style={{ width: badgeSize, height: badgeSize, borderRadius: '50%', background: colors.accent, color: colors.background, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: Math.min(36, height * 0.08), scale: enter, rotate: `${interpolate(frame, [0.2 * fps, 1.2 * fps], [-35, 0], { ...clamp, easing: ease })}deg` }}><svg viewBox="0 0 80 80" width="55%" fill="none"><path d="M18 62L61 19M18 19H61V62" stroke="currentColor" strokeWidth="5" /></svg></div>
    <LineTitle text={scene.title} colors={colors} width={width} height={height * 0.5} maxSize={compact ? 115 : 150} />
    {scene.subtitle && <Subtitle colors={colors} width={width} delay={0.7} maxHeight={height * 0.15} style={{ fontSize: 21, letterSpacing: '0.1em', marginTop: Math.min(38, height * 0.08) }}>{scene.subtitle}</Subtitle>}
  </div>;
};

const SCENES = { title: TitleScene, kinetic: KineticScene, stats: StatsScene, steps: StepsScene, quote: QuoteScene, outro: OutroScene };

const MotionScene = (props: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { scene, index, project, colors, layout } = props;
  const Component = SCENES[scene.type] || TitleScene;
  const fadeFrames = Math.min(0.23 * fps, scene.duration * fps * 0.1);
  const end = Math.round(scene.duration * fps);
  return <AbsoluteFill style={{ opacity: interpolate(frame, [0, fadeFrames, end - fadeFrames, end], [1, 1, 1, 0], clamp) }}>
    <div style={{ position: 'absolute', left: layout.margin, right: layout.margin, top: layout.margin * 0.8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 19, letterSpacing: '0.13em', color: colors.muted }}>
      <span style={{ display: 'flex', gap: 13, alignItems: 'center' }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: colors.accent }} />{SCENE_LABELS[scene.type].toUpperCase()}</span>
      <span>{String(index + 1).padStart(2, '0')} <span style={{ opacity: 0.45 }}> / {String(project.scenes.length).padStart(2, '0')}</span></span>
    </div>
    <Component {...props} />
  </AbsoluteFill>;
};

const Narrator = ({ project, colors, layout }: { project: Project; colors: Colors; layout: Layout }) => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!project.narrator) return null;
  const mediaFrames = project.narrator.duration ? Math.min(durationInFrames, Math.max(1, Math.ceil(project.narrator.duration * fps))) : durationInFrames;
  const width = layout.compact ? layout.canvasWidth * 0.38 : layout.canvasWidth * 0.24;
  const height = layout.compact ? layout.canvasHeight * (layout.portrait ? 0.24 : 0.28) : layout.canvasHeight * 0.55;
  const side = project.narratorPosition === 'left' ? { left: layout.margin } : { right: layout.margin };
  return <Sequence durationInFrames={mediaFrames} premountFor={fps} name="Narrator inset and voice">
      <div style={{ position: 'absolute', ...side, bottom: layout.margin * 1.6, width, height, borderRadius: 18, overflow: 'hidden', background: colors.background, border: `1px solid ${colors.muted}55`, boxShadow: `0 22px 60px ${colors.background}66`, opacity: project.showNarrator ? 1 : 0 }}>
        <Video src={project.narrator.url} volume={project.narratorVolume} premountFor={fps} durationInFrames={mediaFrames} style={{ width: '100%', height: '100%' }} objectFit="cover" />
      </div>
    </Sequence>;
};

/** Shared by the browser Player and local MP4 renderer; every frame is deterministic. */
export const MotionVideo = ({ project }: CompositionProps) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const colors = THEME_COLORS[project.theme] || THEME_COLORS.ember;
  const layout = getLayout(project, width, height);
  let cursor = 0;
  return <AbsoluteFill style={{ background: colors.background, color: colors.foreground, fontFamily: FONT, overflow: 'hidden' }}>
    <AbsoluteFill style={{ backgroundImage: `radial-gradient(${colors.muted}12 1px, transparent 1px)`, backgroundSize: '42px 42px', opacity: 0.45 }} />
    {project.scenes.map((scene, index) => {
      const from = cursor;
      const duration = Math.max(1, Math.round(scene.duration * fps));
      cursor += duration;
      return <Sequence key={scene.id} from={from} durationInFrames={duration} premountFor={fps} name={`${index + 1}. ${scene.title.replaceAll('\n', ' ')}`}><MotionScene scene={scene} project={project} index={index} colors={colors} layout={layout} /></Sequence>;
    })}
    {project.audio && <Audio src={project.audio.url} volume={project.audioVolume} premountFor={fps} />}
    <Narrator project={project} colors={colors} layout={layout} />
    <div style={{ position: 'absolute', left: layout.margin, right: layout.margin, bottom: layout.margin * 0.55, display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: colors.muted, fontSize: 17, letterSpacing: '0.03em' }}>
      <span style={{ maxWidth: '72%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{project.title}</span>
      <div style={{ display: 'flex', gap: 7 }}>{project.scenes.map((scene, index) => {
        const start = project.scenes.slice(0, index).reduce((total, item) => total + Math.round(item.duration * fps), 0);
        const active = frame >= start && frame < start + Math.round(scene.duration * fps);
        return <div key={scene.id} style={{ width: active ? 27 : 6, height: 6, borderRadius: 6, background: active ? colors.accent : colors.muted, opacity: active ? 1 : 0.4 }} />;
      })}</div>
    </div>
    <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, background: colors.accent, opacity: 0.6 }} />
  </AbsoluteFill>;
};
