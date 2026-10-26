import { LAYOUT, TIMING } from '../../config/app';
import { CLOCK_MODES, HOUR_SLIDER_STEP, ONBOARDING, SETTINGS_ROWS, SKY_PRESETS, WEATHERS, WEATHER_TINT } from '../../config/ui';
import { aniOnce, pad } from '../../lib/format';
import { personOf } from '../selectors';
import { unmutedRook } from '../slices/messaging/helpers';
import { sceneSignals } from '../signals';
import type { Ctx } from './context';
import { ACCENT, DIVIDER, ringOf, fgOf, mixAccent, switchStyle } from './css';
import { doorVm } from './doors';
import { COPY } from '../../config/copy';

/** Sky/weather/clock widgets, drawers, ravens, settings, onboarding and the HUD chrome. */
export function hudVm(x: Ctx, door: ReturnType<typeof doorVm>) {
  const { s, seed, sp, icS, ic, props, now } = x; const P = (id: string) => personOf(seed, id);
  const hr = s.hour; const hh = Math.floor(hr); const mm = Math.floor((hr - hh) * 60);
  const cur = WEATHERS.find((w) => w.id === s.wx) ?? WEATHERS[0];
  const ob = s.onb ? ONBOARDING[s.onb - 1] : null;
  const rook = unmutedRook(s.rook, s.prefs.muted);
  const rookUnread = rook.filter((r) => !r.read).length;
  const sig = sceneSignals(s, seed);
  const hudBlocked = s.inside || s.photo || !!s.door;
  const spaceName = (id: string) => s.spaces.find((q) => q.id === id)?.name;
  const settingOn = (key: (typeof SETTINGS_ROWS)[number]['key']) => !!s[key];
  return {
    isles: s.spaces.map((q) => {
      const un = Object.keys(s.incoming).filter((k) => k.startsWith(`${q.id}/`)).reduce((a, k) => a + s.incoming[k], 0);
      return {
        id: q.id, name: q.name, kind: q.id === s.space ? COPY.ui.stateMsgs.hud.youAreHere : q.kind,
        sub: (q.members ? COPY.ui.stateMsgs.hud.members(q.members.toLocaleString('en')) : COPY.ui.stateMsgs.hud.justYou) + (un ? COPY.ui.stateMsgs.hud.newCount(un) : ''),
        bd: ringOf(q.id === s.space), onClick: () => s.sailTo(q.id),
      };
    }),
    hudTitle: s.archi ? COPY.ui.stateMsgs.hud.archiTitle : sp.name,
    hudTag: s.archi ? COPY.ui.stateMsgs.hud.archiTag : sp.tagline,
    archiBd: ringOf(s.archi), toggleArchi: s.toggleArchi, togglePhoto: s.togglePhoto, photo: s.photo,
    hudOp: hudBlocked ? '0' : '1', hudEvents: hudBlocked ? 'none' : 'auto',
    enterVeilOn: !!s.enterVeil && now - s.enterVeil < TIMING.enterVeilVisibleMs,
    ...door,
    railOp: s.photo ? '0' : '1', railEvents: s.photo ? 'none' : 'auto',
    barH: s.photo ? '9vh' : (s.intro ? '12vh' : '0px'), introOn: s.intro && s.town !== 'error',
    flashOn: s.flash > 0 && now - s.flash < TIMING.flashVisibleMs,
    veilOn: !!s.veil, wxTint: WEATHER_TINT[s.wx], wxIcon: icS[cur.icon], wxName: cur.label,
    clockText: `${pad(hh)}:${pad(mm)}`, period: s.period, hourVal: String(Math.round(hr * HOUR_SLIDER_STEP) / HOUR_SLIDER_STEP),
    onHour: (e: { target: { value: string } }) => s.onHour(parseFloat(e.target.value)),
    presets: SKY_PRESETS.map(([name, h, top, bot]) => {
      const on = s.period === name;
      return { name, top, bot, bd: ringOf(on), bg: on ? mixAccent(10) : 'transparent', fg: fgOf(on), onClick: () => s.applyPreset(h) };
    }),
    clockModes: CLOCK_MODES.map(([id, label]) => ({
      label, bd: s.clockMode === id ? ACCENT : 'transparent', fg: fgOf(s.clockMode === id), onClick: () => s.setClockMode(id),
    })),
    weathers: WEATHERS.map((w) => {
      const on = s.wx === w.id;
      return { label: w.label, on: on ? 'true' : 'false', iconEl: ic[w.icon], bd: ringOf(on), bg: on ? mixAccent(12) : 'transparent', fg: fgOf(on), onClick: () => s.setWx(w.id) };
    }),
    toggleAutoWx: s.toggleAutoWx, autoWxBd: switchStyle(s.autoWx).bd, autoWxBg: switchStyle(s.autoWx).bg, autoWxKnob: switchStyle(s.autoWx).knob, autoWxX: switchStyle(s.autoWx).x,
    drawerSky: s.drawer === 'sky', drawerRook: s.drawer === 'rook', drawerSet: s.drawer === 'set', drawerNet: s.drawer === 'net', closeDrawer: s.closeDrawer,
    openSky: () => s.toggleDrawer('sky'), openRookery: () => s.toggleDrawer('rook'), openSettings: () => s.toggleDrawer('set'), openNetwork: () => s.toggleDrawer('net'),
    netPeers: s.node?.peers ?? 0, netState: s.node ? (s.node.running ? (s.node.peers > 0 ? 'ok' : 'alone') : 'off') : 'off', syncPending: s.syncPending,
    meInitials: s.me?.initials ?? '', meAvatar: s.me?.avatar?.hash ?? '',
    openInvite: () => s.openModal({ kind: 'invite', space: sp.id }), openSpaceSettings: () => s.openModal({ kind: 'spaceSettings', space: sp.id }),
    openNewSpace: () => s.openModal({ kind: 'newSpace' }), openJoin: () => s.openModal({ kind: 'join' }), openShortcuts: () => s.openModal({ kind: 'shortcuts' }),
    canInvite: sp.kind !== 'Personal',
    listView: s.listView, toggleListView: () => s.setListView(!s.listView),
    rook: rook.map((r) => ({
      initials: P(r.by).i, from: P(r.by).name, where: spaceName(r.sp), text: r.text, t: r.t, ring: ringOf(!r.read),
      anim: r.fresh ? aniOnce('hm-letter', 520) : 'none', onClick: () => s.openRook(r),
    })),
    rookEmpty: rook.length === 0, rookUnread, hasRookUnread: rookUnread > 0, markRookRead: () => { void s.markRookRead(); },
    hasLetter: !!s.letter && !s.inside && !s.photo && !s.door && !s.drawer,
    letter: s.letter ? { from: s.letter.from, text: s.letter.text, where: spaceName(s.letter.sp) } : null,
    readLetter: s.readLetter, dismissLetter: s.dismissLetter,
    settings: SETTINGS_ROWS.map((r) => ({ label: r.label, sub: r.sub, onClick: () => s.toggleSetting(r.key), ...switchStyle(settingOn(r.key)) })),
    pillsDisp: props.viewport.w < LAYOUT.pillsMinViewport ? 'none' : 'flex',
    perchHereN: String(sig.unread), perchHereText: COPY.ui.stateMsgs.hud.perchHere, perchAwayN: String(sig.perch.away),
    ravenHere: () => s.onRaven('here'), ravenAway: () => s.onRaven('away'), hintsOn: s.hints,
    replayWelcome: s.replayWelcome, replayIntro: s.replayIntro,
    onbOn: !!ob && !s.intro && !s.inside && !s.drawer && !s.photo,
    onb: ob ? { n: s.onb, ...ob } : null,
    onbDots: [1, 2, 3].map((n) => ({ w: n === s.onb ? '22px' : '6px', bg: n <= s.onb ? ACCENT : DIVIDER })),
    nextOnb: () => s.stepOnb(s.onb + 1), skipOnb: () => s.stepOnb(ONBOARDING.length + 1), savePostcard: () => s.savePostcard(sp.name),
  };
}
