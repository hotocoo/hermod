import { useEffect, useRef, type ReactNode } from 'react';
import { useMediaRt } from '@/state/mediaRt';
import s from './hearth.module.css';
import { Face } from '@/components/ui/Face';

export interface TileData {
  id: string; isMe: boolean; speaking: boolean; cam: boolean; noCam: boolean; label: string; ring: string; scale: string; initials: string; av?: string; name: string; muted: boolean; glow: string; anim: string;
}

/** One participant tile in the call grid. The media element is always mounted: remote audio plays through it even when the camera is off. */
export function Tile({ t, micOff }: { t: TileData; micOff: ReactNode }) {
  const stream = useMediaRt((x) => x.streams[t.id]) ?? null;
  const el = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (el.current) el.current.srcObject = stream; }, [stream]);
  return (
    <div className={s.tile} data-testid="tile" data-user={t.id} data-speaking={t.speaking} data-muted={t.muted} data-cam={t.cam} style={{ boxShadow: t.glow, animation: t.anim }}>
      <video ref={el} autoPlay playsInline muted={t.isMe} className={t.cam ? s.video : s.videoHidden} aria-label={t.cam ? `${t.name} camera` : undefined} />
      {t.cam && <div className={s.camTag}><span className={s.camLabel}>{t.label}</span></div>}
      {t.noCam && (
        <div className={s.noCam}>
          <div className={s.bigAvatar} style={{ borderColor: t.ring, transform: `scale(${t.scale})` }}><Face initials={t.initials} av={t.av} /></div>
        </div>
      )}
      <div className={s.nameTag}>{t.name}{t.muted && <span className={s.muted}>{micOff}</span>}</div>
    </div>
  );
}
