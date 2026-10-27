/** Store shape: one interface per slice (data + actions). AppStore is their intersection. */
import type { BlobRef, IdentityInfo, LegalStatus, NodeStatus, ReportOutcome, ReportRow, Role, SearchHit, SearchKind } from '../lib/bridge/types';
import type { Seed, Space, SectionId } from '../lib/data/types';
import type { Theme, Palette } from '../lib/theme';
import type { MotionMode } from '../lib/prefs';
import type { ClockMode, SettingKey, WeatherId } from '../config/ui';
import type { CalEvent, DocBlock, Message, PinBoard, RookEntry, Skein, WorkBoard } from './dataTypes';
import type { Arrival } from './arrivals';
import type { DeskConfig, DeskMacro, LinkKind, MacroAction, ViewFilter } from './deskTypes';
import type { DeskScope, DeskSort, StatusMode } from './vm/desk';

export type TownStatus = 'loading' | 'ok' | 'error';
export interface ToastState { text: string; id: number; kind?: 'weave' | 'error' }
/** Local view of my own call: the room itself (who is in, meeting, notes) comes from the snapshot. */
export interface CallState { space: string; /** Voice channel id; empty is the main hearth room. */ room: string; at: number; muted: boolean; cam: boolean; share: boolean }
export interface StoryCursor { p: number; i: number; at: number }
export interface LetterState { by: string; from: string; text: string; sp: string; ch: string; id: number }
export interface Profile { name: string; role: string; bio: string }
export interface SkyReading { hour: number; period: string; night: number }
export type InputEvt = { target: { value: string } };
export type KeyEvt = { key: string; shiftKey?: boolean; preventDefault(): void };
export type DrawerId = 'sky' | 'rook' | 'set' | 'net';
export type RookRef = Pick<RookEntry, 'sp' | 'ch'>;

/** Boot phases: the gates the user passes before the town. */
export type Phase = 'boot' | 'legal' | 'declined' | 'profile' | 'welcome' | 'app' | 'failed' | 'locked';

/** An attachment waiting in the composer (already stored as a blob). */
export interface Attached { blob: BlobRef; local: string }

export interface PromptField {
  key: string; label: string; placeholder?: string; multiline?: boolean; initial?: string; required?: boolean;
  /** Renders a select with these choices instead of a text box. */
  options?: { value: string; label: string }[];
}
export interface PromptSpec { title: string; kicker?: string; submit: string; fields: PromptField[]; note?: string }
export interface ConfirmSpec { title: string; body: string; confirm: string; danger?: boolean; typed?: string }
export type Modal =
  | { kind: 'newSpace' } | { kind: 'join'; code?: string } | { kind: 'invite'; space: string } | { kind: 'spaceSettings'; space: string }
  | { kind: 'shortcuts' } | { kind: 'about' } | { kind: 'appSettings'; tab?: string } | { kind: 'search' }
  | { kind: 'lightbox'; blob: BlobRef } | { kind: 'composePost' } | { kind: 'composeStory' } | { kind: 'newSnapshot' }
  | { kind: 'forward'; msg: Message } | { kind: 'gallery' } | { kind: 'channelSettings'; space: string; channel: string } | { kind: 'privacy' } | { kind: 'contacts' } | { kind: 'schedule' } | { kind: 'letter' };

export interface CoreSlice {
  seed: Seed | null;
  /** Replace every collection from a fresh snapshot (immutably) and release ravens for what arrived. */
  apply(seed: Seed): void;
  refresh(): Promise<void>;
  refreshSoon(): void;
}

export interface SessionSlice {
  phase: Phase; bootError: string | null; me: IdentityInfo | null; legal: LegalStatus | null;
  node: NodeStatus | null; syncPending: number; blocked: Record<string, true>;
  /** Invite code received from a deep link while a gate was still open. */
  pendingCode: string | null;
  /** A join is running (its proof-of-work search can take seconds); `cancelJoin` stops it. */
  joining: boolean;
  boot(): Promise<void>;
  acceptLegal(shareResources: boolean): Promise<void>;
  declineLegal(): void;
  saveProfile(name: string, bio: string): Promise<boolean>;
  createSpace(name: string, tagline: string, kind: string): Promise<boolean>;
  joinSpace(code: string): Promise<boolean>;
  cancelJoin(): Promise<void>;
  leaveSpace(id: string): Promise<boolean>;
  enterApp(): void;
  onDeeplink(code: string): void;
  setNode(status: NodeStatus): void;
  setSync(pending: number): void;
  setBlocked(ids: string[]): void;
}

export interface NavSlice {
  spaces: Space[]; space: string; section: SectionId; ch: Record<string, string>;
  thread: string | null; overview: boolean; idxPinned: boolean;
  inside: boolean; door: string | null; panelReady: boolean; clipX: number; clipY: number; enterVeil: number;
  galTab: string; shopTab: string; feedTab: string; rev: number;
  forceUpdate(): void;
  goSpace(id: string): void; goSection(sec: SectionId): void; selectSection(sec: SectionId): void;
  goChannel(sp: string, id: string): void; sailTo(id: string | null): void;
  pick(id: string | null, x?: number, y?: number): void; clickBuilding(id: string): void; openBuilding(id: string): void;
  exit(): void; backFromDoor(): void; enterBuilding(id: string): void; paintInside(id: string): void;
  raise(): void; panelW(): number;
  setGalTab(id: string): void; setShopTab(id: string): void; setFeedTab(id: string): void;
  pinIdx(): void; unpinIdx(): void; togglePin(): void; openOverview(): void;
}

export interface SceneSlice {
  ready: boolean; town: TownStatus; hot: string | null; photo: boolean; archi: boolean;
  veil: number; flash: number; intro: boolean; themeBySky: boolean;
  setTownStatus(s: TownStatus): void; setHot(id: string | null): void; hoverBuilding(id: string | null): void;
  onSky(sky: SkyReading): void; onFlash(): void;
  togglePhoto(): void; toggleArchi(): void; replayIntro(): void;
  recenter(): void; zoomIn(): void; zoomOut(): void; rotL(): void; rotR(): void;
}

export interface SkySlice {
  theme: Theme; themePalette: Palette; wx: WeatherId; autoWx: boolean; clockMode: ClockMode;
  hour: number; period: string; night: number;
  skyTheme: boolean; ravens: boolean; hints: boolean; expert: boolean; grain: boolean;
  /** W-006: reduced-motion override; 'system' follows the OS. */
  motion: MotionMode;
  setTheme(t: Theme): void; toggleTheme(): void;
  setMotion(m: MotionMode): void;
  setWx(k: WeatherId): void; stepWeather(): void; toggleAutoWx(): void;
  onHour(h: number): void; applyPreset(h: number): void; setClockMode(m: ClockMode): void;
  toggleSetting(key: SettingKey): void;
}

export interface ChatSlice {
  msgs: Record<string, Message[]>; drafts: Record<string, string>; tdraft: string; attached: Record<string, Attached[]>;
  editing: string | null; editDraft: string; snapRef: string | null;
  setSnapRef(id: string | null): void;
  seen: Record<string, boolean>; incoming: Record<string, number>;
  /** How many messages beyond `LIMITS.messageWindow` the open chat shows ("show earlier"); belongs to one chat key and resets when another opens. */
  chatWin: { key: string; extra: number }; widenChat(key: string, extra: number): void;
  setDraft(v: string): void; send(): Promise<void>; setTDraft(v: string): void; tsend(): Promise<void>;
  react(key: string, mid: string, l: string): Promise<void>;
  startEdit(id: string, text: string): void; setEditDraft(v: string): void; saveEdit(): Promise<void>; cancelEdit(): void;
  deleteMessage(id: string): Promise<void>;
  /** E-006: ask for a reason, then send `content.report` for a message or post. */
  reportContent(id: string, space: string): Promise<void>;
  /** E-006: close a report. `removed` first removes the content (after a confirm); resolves true once the report is closed. */
  resolveReport(space: string, report: ReportRow, outcome: ReportOutcome): Promise<boolean>;
  attachFiles(files: File[]): Promise<void>; attachNative(): Promise<void>; detach(hash: string): void;
  newChannel(): Promise<void>;
  toggleThread(id: string): void; closeThread(): void;
  markSeen(key: string, uptoArrival?: number): void; clearIncoming(key: string): void;
}

export interface CallSlice {
  call: CallState | null; speaking: string | null; /** Everyone whose audio is above the speaking threshold right now (each tile's ring), unlike `speaking`, the one the spotlight sticks to. */ talking: Record<string, true>; stageBig: boolean; now: number; noteDraft: string;
  join(sp: string, room?: string): Promise<void>; joinRoom(): Promise<void>; leave(): Promise<void>; makeMeeting(): Promise<void>;
  setCall(patch: Partial<CallState>): void;
  toggleMute(): Promise<void>; toggleCam(): Promise<void>; toggleShare(): Promise<void>; toggleRecord(): Promise<void>; toggleStage(): void;
 toggleHand(): Promise<void>; /** Call reaction burst on tiles (not a message reaction, see `react`). */ callReact(r: string): Promise<void>; noteHearthSignal(from: string, space: string, p: { room?: unknown; hand?: unknown; react?: unknown }): void;
  toggleAgendaItem(i: number): Promise<void>; setNoteDraft(v: string): void; addNote(): Promise<void>;
  tickNow(): void; returnToCall(): void; backToCall(): void; setSpeaking(id: string | null): void; setTalking(ids: string[]): void;
}

export interface MediaSlice {
  feedSeen: Record<string, boolean>;
  vid: string | null; vidAuto: boolean; speed: number; cc: boolean; theater: boolean; watched: Record<string, number>;
  liveDraft: string;
  story: StoryCursor | null; storySeen: Record<number, boolean>; storyDraft: string;
  toggleLike(id: string, space: string): Promise<void>; toggleSave(id: string, space: string): Promise<void>;
  deletePost(id: string, space: string): Promise<void>;
  /** Comments on a post (`message.post` with `target`); resolves true once appended. */
  commentPost(id: string, space: string, text: string): Promise<boolean>;
  markFeedSeen(space: string): void;
  openVideo(id: string): void; playVideo(id: string): void; stepShort(d: number): void; closeVid(): void; setWatched(id: string, pct: number): void;
  toggleCc(): void; cycleSpeed(): void; toggleTheater(): void; likeVid(): Promise<void>;
  setLiveDraft(v: string): void; sendLive(): Promise<void>; goLive(): Promise<void>; endLive(): Promise<void>;
  openStory(i: number): void; openShort(i: number): void; advanceStory(d: number): void; closeStory(): void;
  setStoryDraft(v: string): void; replyStory(): Promise<void>; loveStory(): Promise<void>;
}

export interface WorkSlice {
  board: Record<string, WorkBoard>; skein: Record<string, Skein>;
  snap: Record<string, string>; line: Record<string, string>;
  docSel: string; events: CalEvent[]; evSel: string | null; pinboards: PinBoard[]; boardSel: string;
  weave(sp: string, lineId: string): Promise<void>; moveCard(sp: string, cardId: string, colId: string): Promise<void>;
  newColumn(): Promise<void>; newCard(colId: string): Promise<void>; editCard(cardId: string): Promise<void>; deleteCard(cardId: string): Promise<void>;
  openSnap(sp: string, id: string): void;
  setLine(lineId: string): void; setExpert(on: boolean): void; toggleExpert(): void;
  newLine(): Promise<void>;
  selectDoc(id: string): void; toggleDocBlock(docId: string, blockId: string): Promise<void>; addDocBlock(docId: string, kind: DocBlock['k']): Promise<void>;
  updateDocBlock(docId: string, blockId: string, text: string): Promise<void>; deleteDocBlock(docId: string, blockId: string): Promise<void>;
  /** Comment on one line of a doc (V-025). */
  commentDocBlock(docId: string, blockId: string): Promise<void>;
  /** Restore a version as new doc.block edits (V-026); resolves false when nothing could be restored. */
  restoreDocVersion(docId: string, seal: string): Promise<boolean>;
  newDoc(): Promise<void>;
  selectEvent(id: string): void; newEvent(): Promise<void>; rsvp(): Promise<void>; cancelEvent(): Promise<void>; editEvent(): Promise<void>; joinEvent(): Promise<void>;
  selectBoard(id: string): void; newBoard(): Promise<void>; addPin(): Promise<void>;
}

export interface DeskSlice {
  deskScope: DeskScope; deskStatus: StatusMode; deskSort: DeskSort; deskQ: string; deskSel: string | null; deskBulk: Record<string, true>;
  /** Composer mode in the open ticket: write an internal note instead of a public reply. */
  deskInternal: boolean; deskPane: 'list' | 'ticket'; deskMatchIds: string[] | null;
  deskSet(p: Partial<Pick<DeskSlice, 'deskScope' | 'deskStatus' | 'deskSort' | 'deskQ' | 'deskInternal' | 'deskPane' | 'deskMatchIds'>>): void;
  deskSelect(id: string | null): void; deskToggleBulk(id: string): void; deskClearBulk(): void; deskOpen(space: string, id: string): void;
  deskCreate(t: import('./slices/desk').NewTicket): Promise<string | null>;
  deskUpdate(ids: string[], patch: import('./slices/desk').TicketPatch): Promise<boolean>;
  deskComment(id: string, body: string, internal: boolean, attachments?: BlobRef[]): Promise<boolean>;
  deskApplyMacro(ids: string[], macro: DeskMacro): Promise<boolean>;
  deskLink(id: string, kind: LinkKind, target: string): Promise<boolean>;
  deskMerge(id: string, into: string): Promise<boolean>;
  deskRate(id: string, score: number, comment?: string): Promise<boolean>;
  deskSaveConfig(c: DeskConfig): Promise<boolean>;
  deskSaveMacro(m: { id?: string; name: string; actions: MacroAction[] }): Promise<boolean>; deskDeleteMacro(id: string): Promise<boolean>;
  deskSaveView(v: { id?: string; name: string; filter: ViewFilter; sort: string; shared: boolean }): Promise<boolean>; deskDeleteView(id: string): Promise<boolean>;
  deskTicketFromMessage(msgId: string): Promise<void>;
}

export interface RavenSlice {
  rook: RookEntry[]; letter: LetterState | null;
  receive(arrivals: Arrival[]): void; openRook(r: RookRef): void; markRookRead(): Promise<void>;
  readLetter(): void; dismissLetter(): void; onRaven(kind: 'here' | 'away'): void;
  sendLetter(toSpace: string, channel: string, text: string): Promise<boolean>;
}

export interface OverlaySlice {
  drawer: DrawerId | null; palette: boolean; q: string; pi: number; hits: SearchHit[]; searchSpace: string; searchKinds: SearchKind[]; toast: ToastState | null;
  profile: boolean; profEdit: boolean; prof: Profile | null; profTab: string; onb: number;
  toggleDrawer(id: DrawerId): void; closeDrawer(): void;
  openPalette(): void; closePalette(): void; togglePalette(): void; setQ(v: string): void; setPi(i: number): void;
  setSearchSpace(id: string): void; toggleSearchKind(k: SearchKind): void;
  runResult(i: number): void;
  showToast(text: string, ms?: number, kind?: ToastState['kind']): void;
  stepOnb(n: number): void; replayWelcome(): void;
  openProfile(): void; closeProfile(): void; toggleEditProf(): Promise<void>;
  setAvatar(): Promise<void>;
  setProfName(v: string): void; setProfBio(v: string): void; setProfTab(id: string): void;
  savePostcard(name: string): void;
}

export interface UiSlice {
  modal: Modal | null; prompt: (PromptSpec & { id: number }) | null; confirm: (ConfirmSpec & { id: number }) | null;
  listView: boolean;
  openModal(m: Modal): void; closeModal(): void;
  /** Ask for text input in a dialog; resolves with the field values, or null when cancelled. */
  ask(spec: PromptSpec): Promise<Record<string, string> | null>;
  settlePrompt(values: Record<string, string> | null): void;
  /** Ask for confirmation before something destructive. */
  confirmAction(spec: ConfirmSpec): Promise<boolean>;
  settleConfirm(ok: boolean): void;
  setListView(on: boolean): void;
}

import type { MessagingSlice } from './slices/messaging/types';
export type AppStore = MessagingSlice & CoreSlice & SessionSlice & NavSlice & SceneSlice & SkySlice & ChatSlice & CallSlice & MediaSlice & WorkSlice & RavenSlice & OverlaySlice & UiSlice & DeskSlice;
export type SetStore = (p: Partial<AppStore> | ((s: AppStore) => Partial<AppStore>)) => void;
export type GetStore = () => AppStore;
/** Minimal store surface the controllers need (satisfied by zustand stores). */
export interface StoreLike { getState(): AppStore; setState: SetStore; subscribe(l: (s: AppStore, prev: AppStore) => void): () => void }

export type { Role };
