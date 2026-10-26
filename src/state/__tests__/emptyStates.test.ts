import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../config/copy';

/** U-016: every list surface routes its empty state through EmptyNote with copy from COPY.empty. Key -> component that renders it. */
const INVENTORY: Record<keyof typeof COPY.empty, string> = {
  chatChannels: 'chat/ChannelList.tsx', chatDms: 'chat/ChannelList.tsx', chatPins: 'chat/ChatHeader.tsx',
  chatThreads: 'chat/ThreadsMenu.tsx', chatThreadsArchived: 'chat/ThreadsMenu.tsx', forwardTargets: 'modals/MessagingModals.tsx',
  feedSaved: 'sections/FeedSection.tsx', videos: 'panel/pages/VideoLibrary.tsx', stories: 'panel/pages/Stories.tsx', liveChat: 'panel/pages/Live.tsx',
  boardColumn: 'sections/board/Column.tsx', pinboards: 'panel/pages/Pinboards.tsx', pinboardShared: 'panel/pages/Pinboards.tsx', pinboardSaved: 'panel/pages/Pinboards.tsx',
  docs: 'panel/pages/Docs.tsx', docComments: 'panel/pages/Docs.tsx', docVersions: 'panel/pages/Docs.tsx', calendarWeek: 'panel/pages/Calendar.tsx',
  deskSearch: 'desk/DeskSection.tsx', deskAgent: 'desk/DeskSection.tsx', deskMember: 'desk/DeskSection.tsx',
  arcadeLobby: 'arcade/Lobby.tsx', arcadeBoard: 'arcade/activities/Leaderboard.tsx', arcadePolls: 'arcade/activities/Polls.tsx',
  arcadeKudos: 'arcade/activities/KudosWall.tsx', arcadeQuizzes: 'arcade/activities/Quizzes.tsx', rookery: 'drawers/RookeryDrawer.tsx',
  paletteIdle: 'overlays/CommandPalette.tsx', paletteNone: 'overlays/CommandPalette.tsx', members: 'modals/SpaceSettingsModal.tsx', invites: 'modals/InviteList.tsx',
};
const src = (rel: string) => readFileSync(resolve(__dirname, '../../components', rel), 'utf8');

describe('empty states (U-016)', () => {
  it('inventories every COPY.empty entry', () => {
    expect(Object.keys(INVENTORY).sort()).toEqual(Object.keys(COPY.empty).sort());
  });
  it.each(Object.entries(INVENTORY))('%s is rendered by EmptyNote in %s', (key, file) => {
    const code = src(file);
    expect(code).toContain("import { EmptyNote } from '@/components/panel/EmptyStates'");
    expect(code).toContain(`COPY.empty.${key}`);
  });
  it.each(Object.entries(COPY.empty))('%s has a title and a line without em-dashes', (_k, e) => {
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.line.length).toBeGreaterThan(0);
    expect(`${e.title}${e.line}`).not.toContain('—');
  });
});
