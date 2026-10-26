import { useEffect, useRef, type ReactNode } from 'react';
import { useMediaRt } from '@/state/mediaRt';
import s from './hearth.module.css';
import { COPY } from '@/config/copy';
import { Face } from '@/components/ui/Face';

export interface TileData {
  id: string; isMe: boolean; speaking: boolean; cam: boolean; share: boolean; noCam: boolean; label: string; ring: string; scale: string; initials: string; av?: string; name: string; muted: boolean; glow: string; anim: string;
}

/** One participant tile in the call grid. The media element is always mounted: remote audio plays through it even when the camera is off. */
export function Tile({ t, micOff }: { t: TileData; micOff: ReactNode }) {
  const stream = useMediaRt((x) => x.streams[t.id]) ?? null;
  const poor = useMediaRt((x) => x.quality[t.id]) === 'poor';
  const hand = useMediaRt((x) => !!x.hands[t.id]);
  const react = useMediaRt((x) => x.reactions[t.id]);
  const live = t.cam || t.share; // a shared screen shows even with the camera off
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (el.current) el.current.srcObject = stream; }, [stream]);
  return (
    <div data-testid="tile" data-user={t.id} data-speaking={t.speaking} data-muted={t.muted} data-cam={t.cam} data-share={t.share} data-hand={hand} data-react={react} data-quality={poor ? 'poor' : undefined} className={`${s.tile} ${t.share ? s.tileShare : ''}`} style={{ boxShadow: t.glow, animation: t.anim }}>
      <video ref={el} autoPlay playsInline muted={t.isMe} className={live ? (t.share ? s.screen : s.video) : s.videoHidden} aria-label={live ? `${t.name} ${t.share ? 'screen' : 'camera'}` : undefined} />
      {live && <div className={s.camTag}><span className={s.camLabel}>{t.label}</span></div>}
      {t.noCam && (
        <div className={s.noCam}>
          <div className={s.bigAvatar} style={{ borderColor: t.ring, transform: `scale(${t.scale})` }}><Face initials={t.initials} av={t.av} /></div>
        </div>
      )}
      {poor && <div className={s.poor} role="status">{COPY.poorLink}</div>}
      {hand && <div className={s.hand} role="img" aria-label="Hand raised">✋</div>}
      {react && <div className={s.reaction} aria-hidden="true">{react}</div>}
      <div className={s.nameTag}>{t.name}{t.muted && <span className={s.muted}>{micOff}</span>}</div>
    </div>
  );
}
