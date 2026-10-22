import type {
  AuditRow, BlobRef, BlockedUser, BridgeEventName, BridgeEvents, DeviceInfo, DeviceLink, EventBody, IdentityInfo, InviteOptions,
  InviteOut, InviteRecord, LegalStatus, Member, NodeSettings, NodeSettingsView, NodeStatus, NotifySettings, OutboxStatus,
  PickOptions, ProfileInput, Role, SearchHit, SearchOptions, SpaceSummary, StorageUsage, UpdateInfo,
} from './types';
import type { Snapshot } from '../data/types';
import type { LocalAiSettings, PrivacySettings, ChatPrefs, ContactCard, GalleryItem, GalleryKind, LinkPreviewOut, MsgHit, MsgSearchOptions, PageResult, Scheduled } from './messagingTypes';

/** Everything the UI may ask of Rust: one method per command of docs/ARCHITECTURE.md section 6. */
export interface Bridge {
  readonly kind: 'tauri' | 'devhost';
  /** URL the WebView loads a blob from (`hermod-blob://<hash>` in Tauri). */
  blobUrl(hash: string): string;

  legalStatus(): Promise<LegalStatus>;
  legalAccept(version: string, shareResources: boolean): Promise<LegalStatus>;
  identityGet(): Promise<IdentityInfo>;
  profileSet(input: ProfileInput): Promise<IdentityInfo>;
  snapshot(): Promise<Snapshot>;

  spaceCreate(name: string, tagline: string, kind: string): Promise<SpaceSummary>;
  spaceLeave(spaceId: string): Promise<void>;
  inviteCreate(spaceId: string, opts?: InviteOptions): Promise<InviteOut>;
  inviteAccept(code: string): Promise<SpaceSummary>;
  inviteList(spaceId: string): Promise<InviteRecord[]>;
  inviteRevoke(spaceId: string, id: string): Promise<void>;
  spaceMembers(spaceId: string): Promise<Member[]>;
  memberSetRole(spaceId: string, user: string, role: Role): Promise<void>;
  memberRemove(spaceId: string, user: string): Promise<void>;

  eventAppend(spaceId: string, body: EventBody): Promise<void>;
  blobPut(path: string): Promise<BlobRef>;
  blobPutBytes(name: string, bytes: Uint8Array): Promise<BlobRef>;
  /** Native file picker (Tauri only); resolves to paths for `blobPut`, or null when cancelled. */
  pickFiles(opts?: PickOptions): Promise<string[] | null>;
  blobSaveAs(hash: string, suggestedName: string): Promise<string | null>;
  saveFile(suggestedName: string, bytes: Uint8Array): Promise<string | null>;

  nodeStatus(): Promise<NodeStatus>;
  nodeSettingsGet(): Promise<NodeSettingsView>;
  nodeSettingsSet(patch: Partial<NodeSettings>): Promise<NodeSettingsView>;
  mediaSignal(spaceId: string, payload: unknown, to?: string): Promise<void>;
  sendEphemeral(spaceId: string, kind: string, payload: unknown): Promise<void>;

  /** Arcade helpers computed by the core that later verifies reveals: commitments, honest answers for hidden words and boards, layout checks. */
  gameLegalMoves(kind: string, gameId: string, options: unknown, moves: { seat: number; move: unknown }[]): Promise<unknown[]>;
  arcadeTool<T = unknown>(op: 'commit' | 'quiz_commit' | 'feedback' | 'layout' | 'shot', args: Record<string, unknown>): Promise<T>;

  readMark(spaceId: string, channelId: string): Promise<void>;
  blockUser(userId: string): Promise<void>;
  unblockUser(userId: string): Promise<void>;
  blockList(): Promise<BlockedUser[]>;
  notifySettingsGet(): Promise<NotifySettings>;
  notifySettingsSet(patch: Partial<NotifySettings>): Promise<NotifySettings>;
  retentionSet(spaceId: string, days: number | null): Promise<void>;
  /** Show an OS notification (the UI already applied mute and Do Not Disturb). */
  notifySend(title: string, body: string, spaceId: string, channelId: string): Promise<void>;

  searchQuery(q: string, opts?: SearchOptions): Promise<SearchHit[]>;
  storageUsage(): Promise<StorageUsage>;
  storageClearCache(): Promise<{ freed_bytes: number }>;
  auditList(spaceId: string): Promise<AuditRow[]>;
  logTail(lines: number): Promise<string[]>;
  outboxStatus(): Promise<OutboxStatus>;
  /** The desktop app opens its own save dialog; `path` is for the devhost only. Resolves to the saved path, or null when cancelled. */
  backupExport(suggestedName: string, passphrase: string, includeBlobs: boolean, path?: string): Promise<string | null>;
  backupImport(path: string, passphrase: string): Promise<void>;
  appReset(): Promise<void>;
  updateCheck(): Promise<UpdateInfo>;
  updateInstall(): Promise<void>;
  deviceLinkStart(): Promise<DeviceLink>;
  deviceLinkAccept(code: string): Promise<void>;
  deviceList(): Promise<DeviceInfo[]>;
  deviceRevoke(devicePub: string): Promise<void>;

  messagesPage<M = unknown>(spaceId: string, channelId: string, before?: number, limit?: number): Promise<PageResult<M>>;
  mediaGallery(spaceId: string, channelId: string, kind: GalleryKind, before?: number, limit?: number): Promise<{ items: GalleryItem[]; has_more: boolean }>;
  messagesSearch(q: string, opts?: MsgSearchOptions): Promise<MsgHit[]>;
  messageHide(spaceId: string, msgId: string): Promise<void>;
  messageUnhide(spaceId: string, msgId: string): Promise<void>;
  chatPrefsGet(): Promise<ChatPrefs>;
  chatPrefsSet(patch: Partial<ChatPrefs>): Promise<ChatPrefs>;
  scheduleAdd(spaceId: string, body: EventBody, at: number): Promise<Scheduled>;
  scheduleList(): Promise<Scheduled[]>;
  scheduleCancel(id: string): Promise<void>;
  savedOpen(): Promise<{ space_id: string; channel_id: string }>;
  dmStart(users: string[], name?: string): Promise<SpaceSummary>;
  dmAccept(id: string): Promise<SpaceSummary>;
  dmDecline(id: string): Promise<void>;
  contactCard(): Promise<ContactCard>;
  contactAdd(code: string): Promise<SpaceSummary>;
  contactRemove(userId: string): Promise<void>;
  linkPreview(url: string): Promise<LinkPreviewOut>;
  privacyGet(): Promise<PrivacySettings>;
  privacySet(patch: Partial<PrivacySettings>): Promise<PrivacySettings>;
  aiLocalGet(): Promise<LocalAiSettings>;
  aiLocalSet(patch: Partial<LocalAiSettings>): Promise<LocalAiSettings>;
  aiLocalRun(task: 'translate' | 'summarize', text: string, target?: string): Promise<string>;

  /** Subscribe to a Rust event. Returns the unsubscribe function. */
  on<K extends BridgeEventName>(name: K, handler: (payload: BridgeEvents[K]) => void): () => void;
}

/** Low-level transport shared by every typed method: Tauri IPC or the devhost HTTP twin. */
export interface Transport {
  readonly kind: Bridge['kind'];
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Binary upload as the raw IPC body (`args` ride in a header). Absent on the devhost, which sends a JSON number array. */
  callRaw?<T>(command: string, args: Record<string, unknown>, bytes: Uint8Array): Promise<T>;
  listen(event: string, handler: (payload: unknown) => void): () => void;
  blobUrl(hash: string): string;
}

/** Rust errors arrive as plain strings; normalise to Error so callers can show `.message`. */
export class BridgeError extends Error {
  constructor(readonly command: string, message: string) { super(message); this.name = 'BridgeError'; }
}

export function createBridge(t: Transport): Bridge {
  const call = <T,>(cmd: string, args?: Record<string, unknown>) => t.call<T>(cmd, args);
  const bytesCall = <T,>(cmd: string, args: Record<string, unknown>, bytes: Uint8Array) =>
    t.callRaw ? t.callRaw<T>(cmd, args, bytes) : t.call<T>(cmd, { ...args, bytes: Array.from(bytes) });
  const none = (cmd: string, args?: Record<string, unknown>) => call<unknown>(cmd, args).then(() => undefined);
  return {
    kind: t.kind,
    blobUrl: (h) => t.blobUrl(h),
    legalStatus: () => call('legal_status'),
    legalAccept: (version, shareResources) => call('legal_accept', { version, shareResources }),
    identityGet: () => call('identity_get'),
    profileSet: (input) => call('profile_set', { ...input }),
    snapshot: () => call('snapshot'),
    spaceCreate: (name, tagline, kind) => call('space_create', { name, tagline, kind }),
    spaceLeave: (spaceId) => none('space_leave', { spaceId }),
    inviteCreate: (spaceId, opts = {}) => call('invite_create', { spaceId, expiresIn: opts.expiresIn ?? null, maxUses: opts.maxUses ?? null, role: opts.role ?? 'member' }),
    inviteAccept: (code) => call('invite_accept', { code }),
    inviteList: (spaceId) => call('invite_list', { spaceId }),
    inviteRevoke: (spaceId, id) => none('invite_revoke', { spaceId, id }),
    spaceMembers: (spaceId) => call('space_members', { spaceId }),
    memberSetRole: (spaceId, user, role) => none('member_set_role', { spaceId, user, role }),
    memberRemove: (spaceId, user) => none('member_remove', { spaceId, user }),
    eventAppend: (spaceId, body) => none('event_append', { spaceId, body }),
    blobPut: (path) => call('blob_put', { path }),
    blobPutBytes: (name, bytes) => bytesCall('blob_put_bytes', { name }, bytes),
    pickFiles: (opts = {}) => call('pick_files', { multiple: !!opts.multiple, accept: opts.accept ?? [] }),
    blobSaveAs: (hash, suggestedName) => call('blob_save_as', { hash, suggestedName }),
    saveFile: (suggestedName, bytes) => bytesCall('save_file', { suggestedName }, bytes),
    nodeStatus: () => call('node_status'),
    nodeSettingsGet: () => call('node_settings_get'),
    nodeSettingsSet: (patch) => call('node_settings_set', { ...patch }),
    mediaSignal: (spaceId, payload, to) => none('media_signal', { spaceId, to: to ?? null, payload }),
    sendEphemeral: (spaceId, kind, payload) => none('send_ephemeral', { spaceId, kind, payload }),
    gameLegalMoves: (kind, gameId, options, moves) => call('game_legal_moves', { kind, gameId, options, moves }),
    arcadeTool: (op, args) => call('arcade_tool', { op, args }),
    readMark: (spaceId, channelId) => none('read_mark', { spaceId, channelId }),
    blockUser: (userId) => none('block_user', { userId }),
    unblockUser: (userId) => none('unblock_user', { userId }),
    blockList: () => call('block_list'),
    notifySettingsGet: () => call('notify_settings_get'),
    notifySettingsSet: (patch) => call('notify_settings_set', { ...patch }),
    retentionSet: (spaceId, days) => none('retention_set', { spaceId, days }),
    notifySend: (title, body, spaceId, channelId) => none('notify_send', { title, body, spaceId, channelId }),
    searchQuery: (q, opts = {}) => call('search_query', { q, space: opts.space ?? null, kinds: opts.kinds ?? null, limit: opts.limit ?? null }),
    storageUsage: () => call('storage_usage'),
    storageClearCache: () => call('storage_clear_cache'),
    auditList: (spaceId) => call('audit_list', { spaceId }),
    logTail: (lines) => call('log_tail', { lines }),
    outboxStatus: () => call('outbox_status'),
    backupExport: (suggestedName, passphrase, includeBlobs, path) => call('backup_export', { suggestedName, passphrase, includeBlobs, path: path ?? null }),
    backupImport: (path, passphrase) => none('backup_import', { path, passphrase }),
    appReset: () => none('app_reset'),
    updateCheck: () => call('update_check'),
    updateInstall: () => none('update_install'),
    deviceLinkStart: () => call('device_link_start'),
    deviceLinkAccept: (code) => none('device_link_accept', { code }),
    deviceList: () => call('device_list'),
    deviceRevoke: (devicePub) => none('device_revoke', { devicePub }),
    messagesPage: (spaceId, channelId, before, limit) => call('messages_page', { spaceId, channelId, before: before ?? null, limit: limit ?? null }),
    mediaGallery: (spaceId, channelId, kind, before, limit) => call('media_gallery', { spaceId, channelId, kind, before: before ?? null, limit: limit ?? null }),
    messagesSearch: (q, o = {}) => call('messages_search', { q, spaceId: o.spaceId ?? null, from: o.from ?? null, in: o.in ?? null, has: o.has ?? null, before: o.before ?? null, after: o.after ?? null, limit: o.limit ?? null }),
    messageHide: (spaceId, msgId) => none('message_hide', { spaceId, msgId }),
    messageUnhide: (spaceId, msgId) => none('message_unhide', { spaceId, msgId }),
    chatPrefsGet: () => call('chat_prefs_get'),
    chatPrefsSet: (patch) => call('chat_prefs_set', { patch }),
    scheduleAdd: (spaceId, body, at) => call('schedule_add', { spaceId, body, at }),
    scheduleList: () => call('schedule_list'),
    scheduleCancel: (id) => none('schedule_cancel', { id }),
    savedOpen: () => call('saved_open'),
    dmStart: (users, name) => call('dm_start', { users, name: name ?? null }),
    dmAccept: (id) => call('dm_accept', { id }),
    dmDecline: (id) => none('dm_decline', { id }),
    contactCard: () => call('contact_card'),
    contactAdd: (code) => call('contact_add', { code }),
    contactRemove: (userId) => none('contact_remove', { userId }),
    linkPreview: (url) => call('link_preview', { url }),
    privacyGet: () => call('privacy_get'),
    privacySet: (patch) => call('privacy_set', { patch }),
    aiLocalGet: () => call('ai_local_get'),
    aiLocalSet: (patch) => call('ai_local_set', { patch }),
    aiLocalRun: (task, text, target) => call('ai_local_run', { task, text, target: target ?? null }),
    on: (name, handler) => t.listen(`hermod://${name}`, (p) => handler(p as never)),
  };
}
