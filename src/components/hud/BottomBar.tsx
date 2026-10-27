import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import s from './BottomBar.module.css';
import { COPY } from '@/config/copy';

export function BottomBar({ vm }: { vm: ViewModel }) {
  const { hintsOn, hudEvents, hudOp, hudY, icS, recenter, rotL, rotR, toggleArchi, togglePhoto, zoomIn, zoomOut } = vm;
  return (
    <div className={s.root} style={{ transform: `translate(-50%,${hudY})`, opacity: hudOp, pointerEvents: pe(hudEvents) }} data-obstacle="1">
      <div className={s.bar}>
        <button className={s.btn} onClick={rotL} aria-label={COPY.ui.shell.bottomBarText.turnLeft} title={COPY.ui.shell.bottomBarText.turnLeftQ}>{icS.left}</button>
        <button className={s.btn} onClick={zoomOut} aria-label={COPY.ui.shell.bottomBarText.zoomOut} title={COPY.ui.shell.bottomBarText.zoomOut2}>−</button>
        <button className={s.compassBtn} onClick={recenter} aria-label={COPY.ui.shell.bottomBarText.recenter} title={COPY.ui.shell.bottomBarText.recenter0}>{icS.compass}</button>
        <button className={s.btn} onClick={zoomIn} aria-label={COPY.ui.shell.bottomBarText.zoomIn} title={COPY.ui.shell.bottomBarText.zoomIn2}>+</button>
        <button className={s.btn} onClick={rotR} aria-label={COPY.ui.shell.bottomBarText.turnRight} title={COPY.ui.shell.bottomBarText.turnRightE}>{icS.right}</button>
        <span className={s.divider} />
        <button className={s.utilBtn} onClick={togglePhoto} aria-label={COPY.ui.shell.bottomBarText.postcardMode} title={COPY.ui.shell.bottomBarText.postcardModeP}>{icS.camera}</button>
        <button className={s.utilBtn} onClick={toggleArchi} aria-label={COPY.ui.shell.bottomBarText.archipelago} title={COPY.ui.shell.bottomBarText.archipelagoM}>{icS.map}</button>
      </div>
      {hintsOn ? (
        <div className={s.hint}>
          {COPY.ui.shell.bottomBarText.mForEveryIslandP}
        </div>
      ) : null}
    </div>
  );
}
