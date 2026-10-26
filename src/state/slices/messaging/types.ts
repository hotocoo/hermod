import type { ChannelSettingsIn, ChatPrefs, LinkPreviewOut, PrivacySettings, QuoteRef, Scheduled } from '../../../lib/bridge';
import type { Message } from '../../dataTypes';
import type { PresenceMap } from '../../presence';

export interface ComposeExtras { quote: QuoteRef | null; viewOnce: boolean; ttl: number; preview: LinkPreviewOut | null; previewFor: string; previewOff: boolean }

export interface MessagingSlice {
  prefs: ChatPrefs; privacy: PrivacySettings; scheduled: Scheduled[];
  /** chatKey -> user -> expiry ms of the typing hint. */
  typing: Record<string, Record<string, number>>;
  /** user -> last beacon (ms) and whether they are idle; entries expire after PRESENCE.ttlMs. */
  presence: PresenceMap;
  /** user -> last beacon or offline packet (ms), kept past the ttl for the last seen text (M-026). */
  lastSeen: Record<string, number>;
  compose: ComposeExtras;
  /** Older pages loaded on demand, keyed by chat. */
  older: Record<string, Message[]>; olderMore: Record<string, boolean>;
  /** Message to scroll to once its chat is open. */
  jump: { key: string; id: string } | null;
  loadMessaging(): Promise<void>;
  savePrefs(patch: Partial<ChatPrefs>): Promise<void>;
  setPrivacy(patch: Partial<PrivacySettings>): Promise<void>;
  togglePinChat(key: string): Promise<void>; toggleArchiveChat(key: string): Promise<void>; muteChat(key: string, ms: number | null): Promise<void>;
  /** Add the chat to a folder, or remove it when it is already there. */
  toggleChatInFolder(folderId: string, key: string): Promise<void>;
  setQuote(m: Message | null): void; toggleViewOnce(): void; setTtl(secs: number): void; dismissPreview(): void; probePreview(text: string): Promise<void>;
  forwardMessage(m: Message, targets: { space: string; channel: string; origin: string }[]): Promise<void>;
  hideForMe(id: string): Promise<void>;
  openViewOnce(m: Message): Promise<void>;
  sendNote(blob: import('../../../lib/bridge').BlobRef, kind: 'voice' | 'video_note', durMs: number, peaks: number[]): Promise<void>;
  sendSticker(sticker: { id: string; blob: import('../../../lib/bridge').BlobRef }): Promise<void>;
  sendGif(blob: import('../../../lib/bridge').BlobRef): Promise<void>;
  addGif(file: File): Promise<void>; addEmoji(file: File, name: string): Promise<void>; addSticker(file: File, name: string, pack: string): Promise<void>;
  scheduleDraft(at: number): Promise<void>; cancelScheduled(id: string): Promise<void>;
  channelSettings(space: string, patch: ChannelSettingsIn): Promise<void>;
  setNick(space: string, nick: string): Promise<void>;
  /** Prepends the next older page; resolves false when nothing more came back. */
  loadOlder(key: string): Promise<boolean>;
  jumpToMessage(space: string, channel: string, id: string): void;
  copyMessageLink(id: string): void; openMessageLink(href: string): boolean;
  pinMessage(id: string): Promise<void>;
  startDm(users: string[], name?: string): Promise<void>; acceptDm(id: string): Promise<void>; declineDm(id: string): Promise<void>;
  openSaved(): Promise<void>; saveToNotes(m: Message): Promise<void>;
  sendRecording(r: import('../../../lib/messaging/recorder').NoteResult, kind: 'voice' | 'video_note'): Promise<void>;
  sendPoll(): Promise<void>;
  /** Runs a local model on text and shows the answer; resolves undefined when local AI is off or fails (a toast says why). */
  localAi(task: 'translate' | 'summarize', text: string): Promise<string | undefined>;
  forumPost(title: string, tags: string[], text: string): Promise<void>;
  setProfileExt(patch: { banner?: File; status?: string; status_emoji?: string; pronouns?: string }): Promise<void>;
  typingPing(): void; noteTyping(from: string, space: string, channel: string): void; notePresence(from: string, away: boolean): void; sweepPresence(): void; dropPresence(from: string): void;
}
