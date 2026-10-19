import type { ViewModel } from '@/state/viewModel';
import { pe } from '../ui/css';
import { SyncPill } from './SyncPill';
import s from './TopBar.module.css';
import { Face } from '@/components/ui/Face';

export function TopBar({ vm }: { vm: ViewModel }) {
  const { clockText, hasRookUnread, hudEvents, hudLive, hudOp, hudUnread, icS, openPalette, openProfile, openRookery, openSettings, openSky, openNetwork, openInvite, canInvite, netState, netPeers, meInitials, period, pillsDisp, rookUnread, wxIcon } = vm;
  return (
    <div className={s.root} style={{ opacity: hudOp, pointerEvents: pe(hudEvents) }} data-obstacle="1">
      <div className={s.pill} style={{ display: pillsDisp }} title="Unread across your Spaces">
        <span className={s.pillIcon}>{icS.chat}</span>
        <span className={s.pillValue}>{hudUnread}</span>
        <span className={s.pillLabel}>unread</span>
      </div>
      <div className={s.pill} style={{ display: pillsDisp }} title="Rooms with people in them">
        <span className={s.pillIcon}>{icS.flame}</span>
        <span className={s.pillValue}>{hudLive}</span>
        <span className={s.pillLabel}>live</span>
      </div>
      <button className={s.searchBtn} onClick={openPalette}>
        {icS.search}
        <span className={s.searchLabel}>Search</span>
        <span className={s.kbd}>⌘K</span>
      </button>
      <button className={s.searchBtn} onClick={openSky} title="Sky and weather">
        <span className={s.pillIcon}>{wxIcon}</span>
        <span className={s.clockText}>{clockText}</span>
        <span className={s.period}>{period}</span>
      </button>
      <button className={s.rookBtn} onClick={openRookery} aria-label={`Rookery, ${rookUnread} new`} title="Rookery: ravens that brought you something">
        {icS.feather}
        {hasRookUnread ? (
          <span className={s.badge}>{rookUnread}</span>
        ) : null}
      </button>
      <button className={s.settingsBtn} onClick={openNetwork} aria-label={`Network, ${netPeers} ${netPeers === 1 ? 'peer' : 'peers'}`} title={netState === 'off' ? 'Network: node not running' : `Network: ${netPeers} peers`}>
        {icS.network}
        {netState === 'ok' ? <span className={s.badge}>{netPeers}</span> : null}
      </button>
      {canInvite ? <button className={s.settingsBtn} onClick={openInvite} aria-label="Invite people" title="Invite people">{icS.plus}</button> : null}
      <button className={s.settingsBtn} onClick={vm.openSpaceSettings} aria-label="Space settings" title="Space settings: members, roles, invites, safety">{icS.users}</button>
      <button className={s.settingsBtn} onClick={openSettings} aria-label="Settings" title="Settings">{icS.sliders}</button>
      <button className={s.settingsBtn} onClick={vm.toggleListView} aria-pressed={vm.listView} aria-label="List view" title="List view: the town as a list, for keyboard and screen readers">{icS.list}</button>
      <SyncPill pending={vm.syncPending} offline={vm.netState === 'off' && vm.syncPending > 0} />
      <div className={s.avatar} onClick={openProfile} role="button" tabIndex={0} title="Your profile">
        <Face initials={meInitials} av={vm.meAvatar} />
        <span className={s.avatarDot} />
      </div>
    </div>
  );
}
