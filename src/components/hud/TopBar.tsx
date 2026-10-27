import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import { SyncPill } from './SyncPill';
import s from './TopBar.module.css';
import { Face } from '@/components/ui/Face';
import { COPY } from '@/config/copy';

export function TopBar({ vm }: { vm: ViewModel }) {
  const { clockText, hasRookUnread, hudEvents, hudLive, hudOp, hudUnread, icS, openPalette, openProfile, openRookery, openSettings, openSky, openNetwork, openInvite, canInvite, netState, netPeers, meInitials, period, pillsDisp, rookUnread, wxIcon } = vm;
  return (
    <div className={s.root} style={{ opacity: hudOp, pointerEvents: pe(hudEvents) }} data-obstacle="1">
      <div className={s.pill} style={{ display: pillsDisp }} title={COPY.ui.shell.topBarText.unreadAcrossYourSpaces}>
        <span className={s.pillIcon}>{icS.chat}</span>
        <span className={s.pillValue}>{hudUnread}</span>
        <span className={s.pillLabel}>{COPY.ui.shell.topBarText.unread}</span>
      </div>
      <div className={s.pill} style={{ display: pillsDisp }} title={COPY.ui.shell.topBarText.roomsWithPeopleInThem}>
        <span className={s.pillIcon}>{icS.flame}</span>
        <span className={s.pillValue}>{hudLive}</span>
        <span className={s.pillLabel}>{COPY.ui.shell.topBarText.live}</span>
      </div>
      <button className={s.searchBtn} onClick={openPalette}>
        {icS.search}
        <span className={s.searchLabel}>{COPY.ui.shell.topBarText.search}</span>
        <span className={s.kbd}>{COPY.ui.shell.topBarText.k}</span>
      </button>
      <button className={s.searchBtn} onClick={openSky} title={COPY.ui.shell.topBarText.skyAndWeather}>
        <span className={s.pillIcon}>{wxIcon}</span>
        <span className={s.clockText}>{clockText}</span>
        <span className={s.period}>{period}</span>
      </button>
      <button className={s.rookBtn} onClick={openRookery} aria-label={COPY.ui.shell.topMore.rookery(rookUnread)} title={COPY.ui.shell.topBarText.rookeryRavensThatBroughtYou}>
        {icS.feather}
        {hasRookUnread ? (
          <span className={s.badge}>{rookUnread}</span>
        ) : null}
      </button>
      <button className={s.settingsBtn} onClick={openNetwork} aria-label={COPY.ui.shell.topMore.networkPeers(netPeers)} title={netState === 'off' ? COPY.ui.shell.topBarText.networkNodeNotRunning : COPY.ui.shell.topMore.networkTitle(netPeers)}>
        {icS.network}
        {netState === 'ok' ? <span className={s.badge}>{netPeers}</span> : null}
      </button>
      {canInvite ? <button className={s.settingsBtn} onClick={openInvite} aria-label={COPY.ui.shell.topBarText.invitePeople} title={COPY.ui.shell.topBarText.invitePeople}>{icS.plus}</button> : null}
      <button className={s.settingsBtn} onClick={vm.openSpaceSettings} aria-label={COPY.ui.shell.topBarText.spaceSettings} title={COPY.ui.shell.topBarText.spaceSettingsMembersRolesInvites}>{icS.users}</button>
      <button className={s.settingsBtn} onClick={openSettings} aria-label={COPY.ui.shell.topBarText.settings} title={COPY.ui.shell.topBarText.settings}>{icS.sliders}</button>
      <button className={s.settingsBtn} onClick={vm.toggleListView} aria-pressed={vm.listView} aria-label={COPY.ui.shell.topBarText.listView} title={COPY.ui.shell.topBarText.listViewTheTownAs}>{icS.list}</button>
      <SyncPill pending={vm.syncPending} offline={vm.netState === 'off' && vm.syncPending > 0} alone={vm.netState === 'alone'} />
      <div className={s.avatar} onClick={openProfile} role="button" tabIndex={0} title={COPY.ui.shell.topBarText.yourProfile}>
        <Face initials={meInitials} av={vm.meAvatar} />
        <span className={s.avatarDot} />
      </div>
    </div>
  );
}
