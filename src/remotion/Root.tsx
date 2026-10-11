import { Composition } from 'remotion';
import { DEMO_PROJECT } from '../../shared/defaults';
import { dimensionsFor, durationFrames } from '../../shared/types';
import { MotionVideo } from './MotionVideo';

export const RemotionRoot = () => <Composition
  id="MotionVideo"
  component={MotionVideo}
  width={1920}
  height={1080}
  fps={30}
  durationInFrames={600}
  defaultProps={{ project: DEMO_PROJECT }}
  calculateMetadata={({ props }) => ({
    ...dimensionsFor(props.project.aspectRatio),
    fps: props.project.fps,
    durationInFrames: Math.max(1, durationFrames(props.project)),
  })}
/>;
