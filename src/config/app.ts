/** Every timing, tuning and id literal the state layer uses. Nothing here may import snapshot data. */

export const STORAGE_KEYS = {
  welcomed: 'hermodr.welcomed',
  /** Last opened Space id, reopened on launch (Home when absent or gone). */
  lastSpace: 'hermodr.lastSpace',
  /** Set once the user has passed (or skipped) the create/join screen. */
  spaced: 'hermodr.spaced',
  /** Appearance overrides (text size multiplier, motion: system | reduce). */
  textScale: 'hermodr.textScale',
  motion: 'hermodr.motion',
} as const;

/** Pseudo-author the core uses for system messages (meeting wrap-up, weave notices). Defined by the contract, not user data. */
export const SYSTEM_ID = 'system';
/** Kind of the personal Space and the id the core gives it. */
export const HOME_KIND = 'Personal';
export const HOME_ID = 'home';

export const TIMING = {
  introMs: 3400,
  onboardingDelayMs: 3900,
  weatherStepMs: 50000,
  nowTickMs: 2000,
  snapshotDebounceMs: 120,
  searchDebounceMs: 180,
  clockTickMs: 1000,
  veilMs: 1200,
  enterVeilMs: 1100,
  enterVeilVisibleMs: 1050,
  flashRefreshMs: 950,
  flashVisibleMs: 900,
  sailDelayMs: 450,
  openRookDelayMs: 1300,
  panelCloseMs: 820,
  paintDelayMs: 60,
  tourStepMs: 1100,
  letterMs: 9000,
  storyMs: 5000,
  heartMs: 2400,
  seenDelayMs: 1200,
  feedSeenDelayMs: 1500,
  enterChatDelayMs: 30,
  liveScrollDelayMs: 30,
  scrollStepsMs: [20, 260, 700],
  paletteFocusMs: 10,
  msgInitialScrollMs: 60,
  /** Graphics quality label re-reads the adaptive tier this often while the drawer is open. */
  qualityPollMs: 1000,
} as const;

export const TOAST_MS = { standard: 3600, storyReply: 3000, profileSaved: 2600, postcard: 3200 } as const;

export const WEATHER_SEQUENCE = ['clear', 'rain', 'clear', 'snow', 'fog', 'clear', 'storm'] as const;
export const INITIAL_WEATHER = 'clear';
export const INITIAL_HOUR = 13;
export const INITIAL_PERIOD = 'Afternoon';

/** Most ravens one snapshot refresh may release, so a backfill never floods the sky. */
export const RAVEN_BURST_MAX = 3;
/** Night factor above which "theme follows sky" switches to dark. */
export const SKY_DARK_THRESHOLD = 0.5;

export const LAYOUT = {
  panelMinPx: 560,
  panelMaxPx: 960,
  panelFrac: 0.6,
  widePanelMaxPx: 1240,
  widePanelFrac: 0.84,
  pillsMinViewport: 1200,
  clipOriginXFrac: 0.3,
  clipOriginYFrac: 0.45,
  panelInsetPx: 16,
  /** Building labels fade out above this screen y (px) instead of sliding under the top bar pills. */
  labelTopClearPx: 72,
} as const;

export const CAMERA = { zoomStep: 5, rotateStep: 0.45 } as const;

export const LIMITS = {
  liveChat: 60,
  hearts: 8,
  threadFaces: 3,
  overviewSnaps: 3,
  overviewFeed: 3,
  paintMessages: 9,
  paintBoardCards: 4,
  paintSkein: 6,
  paletteResults: 9,
  searchHits: 12,
  doorItems: 3,
  feedHintMax: 4,
  animStagger: 10,
} as const;

export const MEDIA = {
  skipSec: 10,
  captionSec: 6,
  speedCycle: { 1: 1.25, 1.25: 1.5, 1.5: 2, 2: 0.75, 0.75: 1 } as Record<number, number>,
  nextUpCount: 3,
  storyBarMs: 5000,
} as const;

export const PROFILE_GRID = { max: 12 } as const;

export const CALENDAR = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  hours: ['08', '09', '10', '11', '12', '13', '14', '15', '16', '17'],
  startHour: 8,
  hourPx: 52,
  minEventPx: 26,
  eventGapPx: 4,
} as const;

export const POSTCARD = {
  fileName: 'hermodr-postcard.png',
  paper: '#f5f0e8',
  ink: '#201f1d',
  accentInk: '#7d5411',
  frame: 'rgba(32,31,29,.2)',
  skyTopFallback: '#dfe6ea',
  skyBottomFallback: '#f3f2f2',
  titleFont: '"Cormorant Garamond", serif',
  subFont: 'Lora, serif',
  padFrac: 0.035,
  capFrac: 0.1,
} as const;

/** Palette heading for the no-query list (current Space channels, then the Hearth, then actions). */
export const PALETTE_JUMP_GROUP = 'Jump back in';

export const KEYS = { palette: 'k', photo: 'p', archi: 'm', mute: 'm', search: '/' } as const;

/** Uploads: size cap per file for the browser path (bytes cross the IPC as a JSON array), and the story lifetime. */
export const UPLOAD = { maxBytes: 64 * 1024 * 1024, storyTtlSecs: 24 * 60 * 60 } as const;
/** Invite expiry choices; null means never. */
export const INVITE_EXPIRY = [
  { label: '1 hour', secs: 3600 }, { label: '1 day', secs: 86400 }, { label: '7 days', secs: 604800 }, { label: 'Never', secs: null },
] as const;

/** Characters before the palette asks the core to search message content. */
export const SEARCH_MIN_CHARS = 2;
