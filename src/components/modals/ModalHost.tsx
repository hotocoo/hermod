'use client';
import { useAppStore } from '@/state/store';
import { AboutModal } from './AboutModal';
import { AppSettingsModal } from './AppSettingsModal';
import { ChannelSettingsModal, ContactsModal, PrivacyModal } from './ChatSettingsModals';
import { ComposePostModal } from './ComposePostModal';
import { ComposeStoryModal } from './ComposeStoryModal';
import { ConfirmDialog } from './ConfirmDialog';
import { InviteModal } from './InviteModal';
import { JoinModal } from './JoinModal';
import { LightboxModal } from './LightboxModal';
import { ForwardModal, GalleryModal, ScheduleModal } from './MessagingModals';
import { NewSnapshotModal } from './NewSnapshotModal';
import { NewSpaceModal } from './NewSpaceModal';
import { PromptDialog } from './PromptDialog';
import { SearchModal } from './SearchModal';
import { ShortcutsModal } from './ShortcutsModal';
import { SpaceSettingsModal } from './SpaceSettingsModal';

/** Renders the open modal (store.modal) plus the prompt and confirm dialogs, which stack above it. */
export function ModalHost() {
  const modal = useAppStore((s) => s.modal);
  return (
    <>
      {modal?.kind === 'newSpace' && <NewSpaceModal />}
      {modal?.kind === 'join' && <JoinModal code={modal.code} />}
      {modal?.kind === 'invite' && <InviteModal space={modal.space} />}
      {modal?.kind === 'spaceSettings' && <SpaceSettingsModal space={modal.space} />}
      {modal?.kind === 'appSettings' && <AppSettingsModal tab={modal.tab} />}
      {modal?.kind === 'shortcuts' && <ShortcutsModal />}
      {modal?.kind === 'search' && <SearchModal />}
      {modal?.kind === 'about' && <AboutModal />}
      {modal?.kind === 'lightbox' && <LightboxModal blob={modal.blob} />}
      {modal?.kind === 'composePost' && <ComposePostModal />}
      {modal?.kind === 'composeStory' && <ComposeStoryModal />}
      {modal?.kind === 'newSnapshot' && <NewSnapshotModal />}
      {modal?.kind === 'forward' && <ForwardModal msg={modal.msg} />}
      {modal?.kind === 'gallery' && <GalleryModal />}
      {modal?.kind === 'schedule' && <ScheduleModal />}
      {modal?.kind === 'channelSettings' && <ChannelSettingsModal space={modal.space} channel={modal.channel} />}
      {modal?.kind === 'privacy' && <PrivacyModal />}
      {modal?.kind === 'contacts' && <ContactsModal />}
      <PromptDialog />
      <ConfirmDialog />
    </>
  );
}
