/** Command palette: item catalogue and ranking. `go` runs the action; callers close the palette. */
import { LIMITS, PALETTE_JUMP_GROUP } from '../config/app';
import { COPY } from '../config/copy';
import { PALETTE_GROUPS as G } from '../config/ui';
import type { Seed } from '../lib/data/types';
import type { SearchHit } from '../lib/bridge';
import { coll } from './dataTypes';
import { spaceOf } from './helpers';
import { isHomeSpace, meId, personOf, roomOf } from './selectors';
import type { AppStore } from './types';

export interface PaletteItem { group: string; label: string; sub: string; icon: string; person?: string; go: () => void }

const HIT_ICON: Record<SearchHit['kind'], string> = { message: 'chat', post: 'compass', note: 'feather', doc: 'doc', card: 'board', snap: 'line', event: 'calendar', ticket: 'list' };

function hitItem(s: AppStore, seed: Seed, h: SearchHit): PaletteItem {
  const sp = spaceOf(s.spaces, h.space_id);
  return {
    group: G.matches, label: h.title || h.snippet, sub: `${sp.name} · ${personOf(seed, h.by).name} · ${h.snippet}`, icon: HIT_ICON[h.kind] ?? 'search',
    go: () => {
      if (h.kind === 'snap') s.openSnap(sp.id, h.id);
      else if (h.kind === 'ticket') s.deskOpen(sp.id, h.id);
      else if (h.channel_id) { if (h.kind === 'message') s.jumpToMessage(sp.id, h.channel_id, h.id); else s.goChannel(sp.id, h.channel_id); }
      else s.goSpace(sp.id);
    },
  };
}

export function paletteItems(s: AppStore, seed: Seed): PaletteItem[] {
  const items: PaletteItem[] = [];
  const me = meId(s);
  const space = (id: string) => spaceOf(s.spaces, id);
  const channels = coll(seed, 'channels');
  const rooms = coll(seed, 'rooms');
  s.spaces.forEach((sp) => items.push({ group: G.spaces, label: sp.name, sub: sp.tagline, icon: isHomeSpace(sp) ? 'home' : 'layers', go: () => s.goSpace(sp.id) }));
  Object.keys(channels).forEach((sp) => channels[sp].forEach((ch) => items.push({
    group: G.channels, label: ch.dm ? ch.name : `#${ch.name}`, sub: `${space(sp).name} · ${ch.topic}`, icon: ch.dm ? 'at' : 'hash', go: () => s.goChannel(sp, ch.id),
  })));
  Object.keys(rooms).forEach((sp) => {
    const room = roomOf(seed, sp); if (!room) return;
    items.push({
      group: G.rooms, label: room.name, icon: 'flame',
      sub: `${space(sp).name} · ${room.inRoom.length ? `${room.inRoom.length} inside` : COPY.paletteEmptyRoom}`,
      go: () => { s.goSpace(sp); s.goSection('hearth'); },
    });
  });
  Object.keys(s.skein).forEach((sp) => s.skein[sp].snaps.forEach((sn) => items.push({
    group: G.snapshots, label: sn.title, sub: `${space(sp).name} · ${sn.line} · ${personOf(seed, sn.by).name}`, icon: 'line', go: () => s.openSnap(sp, sn.id),
  })));
  Object.keys(s.board).forEach((sp) => s.board[sp].cols.forEach((col) => col.cards.forEach((cd) => items.push({
    group: G.tasks, label: cd.title, sub: `${s.board[sp].name} · ${col.name}`, icon: 'board', go: () => { s.goSpace(sp); s.goSection('board'); },
  }))));
  Object.keys(seed.people).filter((k) => k !== 'system' && k !== me).forEach((k) => items.push({
    group: G.people, label: seed.people[k].name, sub: seed.people[k].role, icon: 'at', person: seed.people[k].i,
    go: () => { void s.openDm(k); },
  }));
  const dark = s.theme === 'dark';
  items.push({ group: G.actions, label: dark ? COPY.paletteSwitchLight : COPY.paletteSwitchDark, sub: COPY.paletteTheme, icon: dark ? 'sun' : 'moon', go: () => s.toggleTheme() });
  const hearth = s.spaces.find((x) => x.sections.includes('hearth') && x.id === s.space) ?? s.spaces.find((x) => x.sections.includes('hearth'));
  if (hearth) items.push({ group: G.actions, label: s.call ? COPY.paletteLeave : COPY.paletteDrop, sub: hearth.name, icon: 'flame', go: () => { void (s.call ? s.leave() : s.join(hearth.id)); } });
  items.push({ group: G.actions, label: COPY.paletteNewSpace, sub: '', icon: 'plus', go: () => s.openModal({ kind: 'newSpace' }) });
  items.push({ group: G.actions, label: COPY.paletteShortcuts, sub: '?', icon: 'search', go: () => s.openModal({ kind: 'shortcuts' }) });
  return items;
}

export function paletteResults(s: AppStore, seed: Seed): PaletteItem[] {
  const q = s.q.trim().toLowerCase();
  const items = paletteItems(s, seed);
  if (!q) {
    const here = items.filter((i) => i.group === G.channels && i.sub.startsWith(`${spaceOf(s.spaces, s.space).name} ·`)).slice(0, 3);
    const room = items.find((i) => i.group === G.rooms && i.sub.startsWith(spaceOf(s.spaces, s.space).name));
    const actions = items.filter((i) => i.group === G.actions).slice(0, 2);
    return [...here, ...(room ? [room] : []), ...actions].map((x) => ({ ...x, group: PALETTE_JUMP_GROUP }));
  }
  const local = items.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q)).slice(0, LIMITS.paletteResults);
  return [...local, ...s.hits.map((h) => hitItem(s, seed, h))];
}
