import type { ChannelCfgView, MessagingColl, MessagingView } from '@/lib/bridge/messagingTypes';
import { useAppStore } from '@/state/store';
import type { AppStore } from '@/state/types';

export const msgColl = (s: Pick<AppStore, 'seed'>): MessagingColl | undefined => s.seed?.collections.messaging as MessagingColl | undefined;

/** Messaging projection of the open Space (channel settings, emoji, stickers, nicknames, threads). */
export const useMsgView = (): MessagingView | undefined => useAppStore((s) => msgColl(s)?.spaces?.[s.space]);

/** Settings of the open channel; undefined until the core has folded a `channel.settings` for it. */
export const useChanCfg = (): ChannelCfgView | undefined => useAppStore((s) => msgColl(s)?.spaces?.[s.space]?.channels?.[s.ch[s.space]]);

/** Custom emoji of the open Space. */
export const useCustomEmoji = (): MessagingView['emoji'] => useAppStore((s) => msgColl(s)?.spaces?.[s.space]?.emoji ?? NONE_EMOJI);
/** Stickers of the open Space. */
export const useStickers = (): MessagingView['stickers'] => useAppStore((s) => msgColl(s)?.spaces?.[s.space]?.stickers ?? NONE_STICKERS);
const NONE_EMOJI: MessagingView['emoji'] = [];
const NONE_STICKERS: MessagingView['stickers'] = [];
