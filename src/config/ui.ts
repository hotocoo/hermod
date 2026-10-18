/** Static UI tables: weather, sky presets, onboarding, tabs, skein vocabulary, palette groups. */
import type { IconName } from './icons';

export const WEATHERS = [
  { id: 'clear', label: 'Clear', icon: 'sun' },
  { id: 'rain', label: 'Rain', icon: 'rain' },
  { id: 'snow', label: 'Snow', icon: 'snow' },
  { id: 'fog', label: 'Fog', icon: 'fog' },
  { id: 'storm', label: 'Storm', icon: 'storm' },
] as const;
export type WeatherId = (typeof WEATHERS)[number]['id'];

export const WEATHER_TINT: Record<WeatherId, string> = {
  clear: 'radial-gradient(60% 50% at 75% 15%,rgba(255,214,150,.10),transparent 70%)',
  rain: 'linear-gradient(180deg,rgba(40,46,56,.16),rgba(40,46,56,.06))',
  snow: 'linear-gradient(180deg,rgba(255,255,255,.10),rgba(230,236,245,.06))',
  fog: 'linear-gradient(180deg,rgba(240,238,235,.22),rgba(240,238,235,.32))',
  storm: 'linear-gradient(180deg,rgba(24,26,34,.30),rgba(24,26,34,.12))',
};

/** [name, hour, swatch top, swatch bottom] */
export const SKY_PRESETS: ReadonlyArray<readonly [string, number, string, string]> = [
  ['Dawn', 6.3, '#6a7aa0', '#f0b48a'], ['Morning', 8.5, '#b8cfe2', '#f6eee2'], ['Noon', 12.5, '#d6e3ec', '#f5f3ef'],
  ['Afternoon', 15.5, '#d2dce2', '#f6ebda'], ['Golden hour', 18, '#c6a687', '#f4c58a'], ['Dusk', 19.2, '#59557a', '#e0957a'],
  ['Evening', 20.6, '#232741', '#54424f'], ['Midnight', 0, '#0d111d', '#1d1b25'],
];

export const CLOCK_MODES = [['manual', 'Hold'], ['live', 'Real time'], ['lapse', 'Time-lapse']] as const;
export type ClockMode = (typeof CLOCK_MODES)[number][0];
export const HOUR_SLIDER_STEP = 20;

export const ONBOARDING = [
  { title: 'Every Space is an island', text: 'Your teams, communities and friends each get one. Switch islands from the rail on the left, or press M to see them all at once.', cta: 'Next' },
  { title: 'Buildings are the places you use', text: 'The Commons is chat, the Hearth in the middle is an always-open voice room, the Gallery holds posts, the Workshop holds tasks and the Loom keeps every version of everything.', cta: 'Next' },
  { title: 'Ravens bring your messages', text: 'When someone reaches you, a raven flies in with the letter. The sky follows your day, and you can change the weather from the clock up top.', cta: 'Explore' },
] as const;

/** Settings drawer rows; `key` maps to a store toggle action. */
export const SETTINGS_ROWS = [
  { key: 'skyTheme', label: 'Theme follows the sky', sub: 'Dark after dusk, light after dawn' },
  { key: 'ravens', label: 'Ravens bring messages', sub: 'A raven flies in when someone reaches you' },
  { key: 'autoWx', label: 'Follow the forecast', sub: 'Let the weather change on its own' },
  { key: 'expert', label: 'Expert words in Skein', sub: 'Commit, branch and merge instead of snapshot, line and weave' },
  { key: 'grain', label: 'Paper grain', sub: 'A fine texture over everything' },
  { key: 'hints', label: 'Show camera hints', sub: 'The line of tips under the camera controls' },
] as const;
export type SettingKey = (typeof SETTINGS_ROWS)[number]['key'];

export const GALLERY_TABS: ReadonlyArray<readonly [string, string, IconName, boolean?]> = [
  ['feed', 'For you', 'compass'], ['watch', 'Watch', 'play'], ['live', 'Live', 'wave', true], ['stories', 'Stories', 'eye'], ['boards', 'Boards', 'bookmark'],
];
export const SHOP_TABS: ReadonlyArray<readonly [string, string, IconName, boolean?]> = [
  ['board', 'Board', 'board'], ['docs', 'Docs', 'doc'], ['cal', 'Calendar', 'calendar'],
];
export const PROFILE_TABS = [['posts', 'Posts'], ['videos', 'Videos'], ['snaps', 'Snapshots'], ['saved', 'Saved']] as const;
export const PROFILE_TILE_LABEL = { posts: 'photo', videos: 'video', snaps: 'snapshot', saved: 'saved' } as const;
export const WIDE_GALLERY_TABS = ['live', 'boards', 'watch'] as const;
export const WIDE_SHOP_TABS = ['docs', 'cal'] as const;

export const SKEIN_TERMS = {
  expert: { snapshot: 'commit', snapshots: 'Commits', line: 'branch', lines: 'Branches', weave: 'Merge', compare: 'Diff', ledger: 'Log', seal: 'Object id' },
  plain: { snapshot: 'snapshot', snapshots: 'Snapshots', line: 'line', lines: 'Lines', weave: 'Weave', compare: 'Compare', ledger: 'Ledger', seal: 'Seal' },
} as const;
export const SKEIN_FILE_KIND_LABEL: Record<string, string> = { swatch: 'Palette', code: 'Rust source', doc: 'Text', audio: 'Audio' };
export const SKEIN_SEAL_SHORT = { plain: 7, expert: 12 } as const;
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, monospace';

export const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'] as const;
export const TILE_COLS = { one: '1fr', two: 'repeat(2, minmax(0,1fr))', three: 'repeat(3, minmax(0,1fr))' } as const;

export const SIGNPOST = { id: 'search', name: 'The Signpost', kicker: 'Find', sub: 'Search everything · ⌘K', aria: 'Search everything' } as const;
export const EMPTY_PLOT = { name: 'Empty plot', raise: 'Raise ' } as const;

export const PALETTE_GROUPS = { spaces: 'Spaces', channels: 'Channels', rooms: 'Rooms', snapshots: 'Snapshots', tasks: 'Tasks', people: 'People', actions: 'Actions', matches: 'In your messages and documents' } as const;
