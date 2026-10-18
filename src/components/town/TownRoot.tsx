'use client';
import { useViewModel } from '@/state/useViewModel';
import { ModalHost } from '@/components/modals/ModalHost';
import { Panel } from '@/components/panel/Panel';
import { LiveHost } from '@/components/panel/pages/LiveHost';
import { CallMedia } from '@/components/sections/hearth/CallMedia';
import { useMediaRt } from '@/state/mediaRt';
import { useAppStore } from '@/state/store';
import { BottomBar } from '../hud/BottomBar';
import { CallPill } from '../hud/CallPill';
import { Controls } from '../hud/Controls';
import { Header } from '../hud/Header';
import { SpaceRail } from '../hud/SpaceRail';
import { TopBar } from '../hud/TopBar';
import { CommandPalette } from '../overlays/CommandPalette';
import { Intro } from '../overlays/Intro';
import { Letter } from '../overlays/Letter';
import { Letterbox } from '../overlays/Letterbox';
import { Onboarding } from '../overlays/Onboarding';
import { PhotoMode } from '../overlays/PhotoMode';
import { Profile } from '../overlays/Profile';
import { StoryViewer } from '../overlays/StoryViewer';
import { Toast } from '../overlays/Toast';
import { RookeryDrawer } from '../drawers/RookeryDrawer';
import { NetworkDrawer } from '../drawers/NetworkDrawer';
import { SettingsDrawer } from '../drawers/SettingsDrawer';
import { SkyDrawer } from '../drawers/SkyDrawer';
import { ListView } from './ListView';
import { SceneOverlay } from './SceneOverlay';
import { Stage } from './Stage';
import { TownStatus } from './TownStatus';
import s from './TownRoot.module.css';

/** Root of the town view: scene mount, HUD, overlays, drawers and the panel. */
export function TownRoot() {
  const vm = useViewModel();
  const callSpace = useAppStore((x) => x.call?.space ?? null);
  const callRoom = useAppStore((x) => x.call?.room ?? '');
  const hosting = useMediaRt((x) => x.hosting);
  if (!vm.ready) {
    return (
      <div className={s.root}>
        <TownStatus vm={vm} />
      </div>
    );
  }
  return (
    <div className={s.root}>
      <Stage vm={vm} />
      <SceneOverlay vm={vm} />
      <Header vm={vm} />
      <SpaceRail vm={vm} />
      <TopBar vm={vm} />
      <BottomBar vm={vm} />
      <Controls vm={vm} />
      <Letter vm={vm} />
      <Letterbox vm={vm} />
      <Intro vm={vm} />
      <PhotoMode vm={vm} />
      <SkyDrawer vm={vm} />
      <RookeryDrawer vm={vm} />
      <SettingsDrawer vm={vm} />
      <NetworkDrawer vm={vm} />
      <ListView />
      <Onboarding vm={vm} />
      <StoryViewer vm={vm} />
      <Profile vm={vm} />
      <CallPill vm={vm} />
      <TownStatus vm={vm} />
      <Panel />
      <CommandPalette vm={vm} />
      <Toast vm={vm} />
      <ModalHost />
      {callSpace && <CallMedia key={`${callSpace}/${callRoom}`} space={callSpace} room={callRoom} />}
      {hosting && <LiveHost key={hosting.liveId} liveId={hosting.liveId} space={hosting.space} />}
    </div>
  );
}
