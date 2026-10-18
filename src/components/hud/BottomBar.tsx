import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import s from './BottomBar.module.css';

export function BottomBar({ vm }: { vm: ViewModel }) {
  const { hintsOn, hudEvents, hudOp, hudY, icS, recenter, rotL, rotR, toggleArchi, togglePhoto, zoomIn, zoomOut } = vm;
  return (
    <div className={s.root} style={{ transform: `translate(-50%,${hudY})`, opacity: hudOp, pointerEvents: pe(hudEvents) }} data-obstacle="1">
      <div className={s.bar}>
        <button className={s.btn} onClick={rotL} aria-label="Turn left" title="Turn left (Q)">{icS.left}</button>
        <button className={s.btn} onClick={zoomOut} aria-label="Zoom out" title="Zoom out (−)">−</button>
        <button className={s.compassBtn} onClick={recenter} aria-label="Recenter" title="Recenter (0)">{icS.compass}</button>
        <button className={s.btn} onClick={zoomIn} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button className={s.btn} onClick={rotR} aria-label="Turn right" title="Turn right (E)">{icS.right}</button>
        <span className={s.divider} />
        <button className={s.utilBtn} onClick={togglePhoto} aria-label="Postcard mode" title="Postcard mode (P)">{icS.camera}</button>
        <button className={s.utilBtn} onClick={toggleArchi} aria-label="Archipelago" title="Archipelago (M)">{icS.map}</button>
      </div>
      {hintsOn ? (
        <div className={s.hint}>
          M for every island · P for a postcard · Click a building to step inside · drag to turn · right-drag to pan · scroll to zoom
        </div>
      ) : null}
    </div>
  );
}
