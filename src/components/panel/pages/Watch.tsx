import type { VmProps } from '../types';
import { VideoPlayer } from './VideoPlayer';
import { VideoLibrary } from './VideoLibrary';
import s from './video.module.css';

/** Gallery "Watch" tab: the open video, or the shorts and long-watch library. */
export function Watch({ vm }: VmProps) {
  return (
    <div className={s.page}>
      {vm.vidOpen && <VideoPlayer vm={vm} />}
      {vm.vidClosed && <VideoLibrary vm={vm} />}
    </div>
  );
}
