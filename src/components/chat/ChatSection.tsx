import { useState } from 'react';
import type { VmProps } from '@/components/panel/types';
import { ChannelList } from './ChannelList';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { ThreadPane } from './ThreadPane';
import s from './chat.module.css';

const NARROW_PX = 900;

/** Chat page: channel list, then header, message log and composer, with the thread margin on top. */
export function ChatSection({ vm }: VmProps) {
  const [navOpen, setNavOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > NARROW_PX);
  return (
    <div className={s.layout}>
      <ChannelList vm={vm} open={navOpen} />
      <div className={s.main}>
        <ChatHeader vm={vm} onToggleNav={() => setNavOpen((v) => !v)} navOpen={navOpen} />
        <MessageList vm={vm} />
        <Composer vm={vm} />
      </div>
      <ThreadPane vm={vm} />
    </div>
  );
}
