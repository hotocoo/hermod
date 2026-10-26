'use client';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Switch } from '@/components/ui/Switch';
import { getBridge, type ChannelKind, type ChannelSettingsIn, type Role } from '@/lib/bridge';
import type { AutoTrigger, LocalAiSettings as LocalAi } from '@/lib/bridge/messagingTypes';
import { TTL_CHOICES } from '@/state/slices/messaging/helpers';
import { uid, appendEvent } from '@/state/act';
import { useAppStore } from '@/state/store';
import { msgColl } from '@/components/chat/useMsgView';
import { CopyField } from './CopyField';
import { QrSvg } from './QrSvg';
import { safetyNumber } from '@/lib/messaging/safety';
import { COPY } from '@/config/copy';
import f from '@/components/ui/form.module.css';
import x from '@/components/chat/messaging.module.css';

const KINDS: ChannelKind[] = ['text', 'announcement', 'forum', 'voice', 'stage'];
const ROLES: Role[] = ['guest', 'member', 'admin', 'owner'];
const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

function Sel<T extends string>({ id, label, value, opts, set }: { id: string; label: string; value: T; opts: T[]; set: (v: T) => void }) {
  return <div className={f.field}><label className={f.label} htmlFor={id}>{label}</label><select id={id} className="input" value={value} onChange={(e) => set(e.target.value as T)}>{opts.map((o) => <option key={o}>{o}</option>)}</select></div>;
}

/** Channel structure and permissions (docs/MESSAGING.md 3.18) plus keyword automations (3.22). */
export function ChannelSettingsModal({ space, channel }: { space: string; channel: string }) {
  const C = COPY.ui.settingsModals.chan;
  const st = useAppStore(); const view = msgColl(st)?.spaces?.[space]; const cfg = view?.channels?.[channel];
  const chan = st.seed ? (st.seed.collections.channels as Record<string, { id: string; name: string; topic: string; dm?: string }[]>)[space]?.find((c) => c.id === channel) : undefined;
  const [v, setV] = useState({
    name: chan?.name ?? '', topic: chan?.topic ?? '', kind: (cfg?.kind ?? 'text') as ChannelKind, category: cfg?.category ?? '', slowmode: String(cfg?.slowmodeSecs ?? 0), ttl: String(cfg?.ttlSecs ?? 0),
    sendMin: (cfg?.sendMin ?? 'member') as Role, viewMin: (cfg?.viewMin ?? 'guest') as Role, manageMin: (cfg?.manageMin ?? 'owner') as Role, mentionMin: (cfg?.mentionMin ?? 'admin') as Role,
    tags: (cfg?.tags ?? []).join(', '), archive: String(cfg?.autoArchiveSecs ?? 0),
  });
  const set = <K extends keyof typeof v>(k: K) => (val: (typeof v)[K]) => setV((p) => ({ ...p, [k]: val }));
  const [words, setWords] = useState(''); const [reply, setReply] = useState(''); const [ruleName, setRuleName] = useState('');
  const save = async () => {
    const patch: ChannelSettingsIn = {
      channel_id: channel, name: v.name.trim() || undefined, topic: v.topic, kind: v.kind, category: v.category.trim().slice(0, 32), slowmode_secs: Math.min(21_600, num(v.slowmode)), ttl_secs: num(v.ttl),
      send_min: v.sendMin, view_min: v.viewMin, manage_min: v.manageMin, mention_min: v.mentionMin, tags: v.tags.split(',').map((t) => t.trim().slice(0, 32)).filter(Boolean).slice(0, 24), auto_archive_secs: num(v.archive),
    };
    await st.channelSettings(space, patch); st.closeModal();
  };
  const addRule = async () => {
    const trigger: AutoTrigger = { kind: 'keyword', channel, words: words.split(',').map((w) => w.trim()).filter(Boolean) };
    if (await appendEvent(() => useAppStore.getState(), space, { t: 'automation.set', id: uid('au'), name: ruleName.trim() || C.ruleDefaultName, enabled: true, trigger, action: { kind: 'post_message', channel, text: reply } })) { setWords(''); setReply(''); setRuleName(''); }
  };
  const rules = (view?.automations ?? []).filter((a) => a.trigger.channel === channel || !a.trigger.channel);
  return (
    <Dialog title={C.title} kicker={chan ? `#${chan.name}` : ''} onClose={st.closeModal} wide>
      <div className={f.field} style={{ gap: 12 }}>
        <div className={f.field}><label className={f.label} htmlFor="cs-name">{C.name}</label><input id="cs-name" className="input" value={v.name} onChange={(e) => set('name')(e.target.value)} /></div>
        <div className={f.field}><label className={f.label} htmlFor="cs-topic">{C.topic}</label><input id="cs-topic" className="input" value={v.topic} onChange={(e) => set('topic')(e.target.value)} /></div>
        {chan?.dm && <SafetyNumber peer={chan.dm} peerName={st.seed?.people[chan.dm]?.name ?? COPY.safetyOther} me={st.me?.user_id ?? ''} />}
        <Sel id="cs-kind" label={C.kind} value={v.kind} opts={KINDS} set={set('kind')} />
        <div className={f.field}><label className={f.label} htmlFor="cs-cat">{C.category}</label><input id="cs-cat" className="input" maxLength={32} value={v.category} onChange={(e) => set('category')(e.target.value)} /></div>
        <div className={f.field}><label className={f.label} htmlFor="cs-slow">{C.slowmode}</label><input id="cs-slow" className="input" inputMode="numeric" value={v.slowmode} onChange={(e) => set('slowmode')(e.target.value)} /></div>
        <div className={f.field}><label className={f.label} htmlFor="cs-ttl">{C.ttl}</label>
          <select id="cs-ttl" className="input" value={v.ttl} onChange={(e) => set('ttl')(e.target.value)}>{[...TTL_CHOICES.map((c) => ({ ...c, secs: String(c.secs) })), ...(TTL_CHOICES.some((c) => String(c.secs) === v.ttl) ? [] : [{ label: C.ttlSeconds(v.ttl), secs: v.ttl }])].map((c) => <option key={c.secs} value={c.secs}>{c.label}</option>)}</select></div>
        <Sel id="cs-send" label={C.sendMin} value={v.sendMin} opts={ROLES} set={set('sendMin')} />
        <Sel id="cs-view" label={C.viewMin} value={v.viewMin} opts={ROLES} set={set('viewMin')} />
        <Sel id="cs-manage" label={C.manageMin} value={v.manageMin} opts={ROLES} set={set('manageMin')} />
        <Sel id="cs-mention" label={C.mentionMin} value={v.mentionMin} opts={ROLES} set={set('mentionMin')} />
        {v.kind === 'forum' && <div className={f.field}><label className={f.label} htmlFor="cs-tags">{C.forumTags}</label><input id="cs-tags" className="input" value={v.tags} onChange={(e) => set('tags')(e.target.value)} /></div>}
        <div className={f.field}><label className={f.label} htmlFor="cs-arch">{C.archive}</label><input id="cs-arch" className="input" inputMode="numeric" value={v.archive} onChange={(e) => set('archive')(e.target.value)} /></div>
        <div className={f.actions}><button type="button" className="btn btn-secondary" onClick={st.closeModal}>{C.cancel}</button><button type="button" className="btn btn-primary" onClick={() => { void save(); }}>{C.save}</button></div>
        <h3 style={{ margin: '12px 0 0' }}>{C.automations}</h3>
        <p className={f.note}>{C.automationsNote}</p>
        {rules.map((a) => (
          <div key={a.id} className={x.listRow}><span className={x.grow}>{C.ruleSummary(a.name, a.trigger.words?.join(', ') ?? a.trigger.tag ?? '', a.action.text ?? '', a.enabled)}</span>
            <button type="button" className="btn btn-secondary" onClick={() => { void appendEvent(() => useAppStore.getState(), space, { t: 'automation.set', id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, action: a.action, deleted: true }); }}>{C.delete}</button></div>
        ))}
        <div className={f.row}>
          <input className="input" aria-label={C.ruleName} placeholder={C.ruleName} value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
          <input className="input" aria-label={C.keywordsLabel} placeholder={C.keywordsHint} value={words} onChange={(e) => setWords(e.target.value)} />
          <input className="input" aria-label={C.replyText} placeholder={C.replyText} value={reply} onChange={(e) => setReply(e.target.value)} />
          <button type="button" className="btn btn-secondary" disabled={!words.trim() || !reply.trim()} onClick={() => { void addRule(); }}>{C.addRule}</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Optional local-model plugin: translation and summaries via a model server on this computer. Off by default. */
function LocalAiSettings() {
  const C = COPY.ui.settingsModals.ai;
  const [cfg, setCfg] = useState<LocalAi | null>(null); const [err, setErr] = useState('');
  useEffect(() => { void getBridge().aiLocalGet().then(setCfg).catch((e: Error) => setErr(e.message)); }, []);
  const save = (patch: Partial<LocalAi>) => { setErr(''); getBridge().aiLocalSet(patch).then(setCfg).catch((e: Error) => setErr(e.message)); };
  if (!cfg) return null;
  return (
    <>
      <h3 style={{ margin: '10px 0 0' }}>{C.title}</h3>
      <Switch label={C.use} sub={C.useSub} on={cfg.enabled} onChange={(on) => save({ enabled: on })} />
      <div className={f.row}>
        <input className="input" aria-label={C.endpoint} defaultValue={cfg.endpoint} onBlur={(e) => { if (e.target.value !== cfg.endpoint) save({ endpoint: e.target.value }); }} />
        <input className="input" aria-label={C.modelLabel} placeholder={C.modelHint} defaultValue={cfg.model} onBlur={(e) => { if (e.target.value !== cfg.model) save({ model: e.target.value }); }} />
      </div>
      {err && <p className={f.error} role="alert">{err}</p>}
    </>
  );
}

/** Receipts, typing, last seen and previews toggles, folders, nickname and profile extras. */
export function PrivacyModal() {
  const C = COPY.ui.settingsModals.priv;
  const st = useAppStore(); const p = st.privacy; const prefs = st.prefs;
  const [nick, setNick] = useState(''); const [folder, setFolder] = useState(''); const [types, setTypes] = useState<string[]>([]);
  const [status, setStatus] = useState(''); const [emoji, setEmoji] = useState(''); const [pron, setPron] = useState('');
  const addFolder = async () => { const name = folder.trim(); if (!name) return; const picked = types; setFolder(''); setTypes([]); /* cleared before the save, so what is typed while it runs is kept */ await st.savePrefs({ folders: [...(prefs.folders ?? []), { id: uid('f'), name, include: [], types: picked as ('dm' | 'group' | 'space' | 'unread')[] }] }); };
  return (
    <Dialog title={C.title} kicker={C.kicker} onClose={st.closeModal} wide>
      <div className={f.field} style={{ gap: 10 }}>
        <Switch label={C.receipts} sub={C.receiptsSub} on={p.receipts} onChange={(on) => { void st.setPrivacy({ receipts: on }); }} />
        <Switch label={C.typing} on={p.typing} onChange={(on) => { void st.setPrivacy({ typing: on }); }} />
        <Switch label={C.presence} on={p.presence} onChange={(on) => { void st.setPrivacy({ presence: on }); }} />
        <Switch label={C.previews} sub={C.previewsSub} on={p.previews} onChange={(on) => { void st.setPrivacy({ previews: on }); }} />
        <LocalAiSettings />
        <h3 style={{ margin: '10px 0 0' }}>{C.nickHeading}</h3>
        <div className={f.row}><input className="input" aria-label={C.nickname} placeholder={C.nickname} maxLength={32} value={nick} onChange={(e) => setNick(e.target.value)} /><button type="button" className="btn btn-secondary" onClick={() => { void st.setNick(st.space, nick.trim()); }}>{C.save}</button></div>
        <h3 style={{ margin: '10px 0 0' }}>{C.extras}</h3>
        <div className={f.row}>
          <input className="input" aria-label={C.status} placeholder={C.status} maxLength={80} value={status} onChange={(e) => setStatus(e.target.value)} />
          <input className="input" aria-label={C.statusEmoji} placeholder={C.emoji} maxLength={8} value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ width: 80 }} />
          <input className="input" aria-label={C.pronouns} placeholder={C.pronouns} maxLength={24} value={pron} onChange={(e) => setPron(e.target.value)} style={{ width: 120 }} />
        </div>
        <div className={f.row}>
          <label className={f.label} htmlFor="pf-banner">{C.banner}</label>
          <input id="pf-banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file) void st.setProfileExt({ banner: file }); e.target.value = ''; }} />
          <button type="button" className="btn btn-secondary" onClick={() => { void st.setProfileExt({ status, status_emoji: emoji, pronouns: pron }); }}>{C.saveProfile}</button>
        </div>
        <h3 style={{ margin: '10px 0 0' }}>{C.folders}</h3>
        {(prefs.folders ?? []).map((fo) => (
          <div key={fo.id} className={x.listRow}><span className={x.grow}>{fo.name} <span className={x.meta}>{fo.types.join(', ') || C.folderChats(fo.include.length)}</span></span>
            <button type="button" className="btn btn-secondary" onClick={() => { void st.savePrefs({ folders: (prefs.folders ?? []).filter((q) => q.id !== fo.id) }); }}>{C.delete}</button></div>
        ))}
        <div className={f.row}>
          <input className="input" aria-label={C.folderName} placeholder={C.newFolder} value={folder} onChange={(e) => setFolder(e.target.value)} />
          {['dm', 'group', 'space', 'unread'].map((t) => <label key={t} className={f.check}><input type="checkbox" checked={types.includes(t)} onChange={() => setTypes(types.includes(t) ? types.filter((q) => q !== t) : [...types, t])} /> {t}</label>)}
          <button type="button" className="btn btn-secondary" disabled={!folder.trim()} onClick={() => { void addFolder(); }}>{C.addFolder}</button>
        </div>
        <div className={f.actions}><button type="button" className="btn btn-primary" onClick={st.closeModal}>{C.done}</button></div>
      </div>
    </Dialog>
  );
}

/** New message (direct or group), my contact card as QR and link, add a contact by code. */
export function ContactsModal() {
  const C = COPY.ui.settingsModals.contacts;
  const st = useAppStore(); const people = st.seed?.people ?? {}; const me = st.me?.user_id;
  const [tab, setTab] = useState<'new' | 'card' | 'add'>('new'); const [picked, setPicked] = useState<string[]>([]); const [name, setName] = useState('');
  const [card, setCard] = useState<{ link: string; code: string } | null>(null); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const ids = Object.keys(people).filter((id) => id !== 'system' && id !== me);
  const contacts = new Set(st.prefs.contacts ?? []);
  const makeCard = async () => { setBusy(true); try { const c = await getBridge().contactCard(); setCard({ link: c.link, code: c.code }); } catch (e) { st.showToast((e as Error).message, undefined, 'error'); } finally { setBusy(false); } };
  const add = async () => {
    setBusy(true);
    try { const sum = await getBridge().contactAdd(code.trim()); await st.refresh(); await st.loadMessaging(); st.goSpace(sum.label); st.closeModal(); }
    catch (e) { st.showToast((e as Error).message, undefined, 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog title={C.title} kicker={C.kicker} onClose={st.closeModal}>
      <div role="tablist" className={x.folderRow}>
        {([['new', C.tabNew], ['card', C.tabCard], ['add', C.tabAdd]] as const).map(([id, l]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`${x.chip2} ${tab === id ? x.chipOn : ''}`} onClick={() => { setTab(id); if (id === 'card' && !card) void makeCard(); }}>{l}</button>)}
      </div>
      {tab === 'new' && (
        <div className={f.field}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 260, overflow: 'auto' }}>
            {ids.map((id) => (
              <li key={id} className={x.listRow}><label className={f.check}><input type="checkbox" checked={picked.includes(id)} onChange={() => setPicked(picked.includes(id) ? picked.filter((q) => q !== id) : [...picked, id])} /> {people[id].name}{contacts.has(id) ? C.contactSuffix : ''}</label>
                {contacts.has(id)
                  ? <button type="button" className="btn btn-secondary" onClick={() => { void getBridge().contactRemove(id).then(() => st.loadMessaging()); }}>{C.removeContact}</button>
                  : <button type="button" className="btn btn-secondary" onClick={() => { void st.savePrefs({ contacts: [...contacts, id] }); }}>{C.addContact}</button>}
              </li>
            ))}
            {ids.length === 0 && <li className={x.empty}>{C.noPeople}</li>}
          </ul>
          {picked.length > 1 && <input className="input" aria-label={C.groupName} placeholder={C.groupNameHint} value={name} onChange={(e) => setName(e.target.value)} />}
          <p className={f.note}>{C.requestNote}</p>
          <div className={f.actions}><button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => { void st.startDm(picked, name.trim() || undefined).then(st.closeModal); }}>{picked.length > 1 ? C.startGroup : C.startChat}</button></div>
        </div>
      )}
      {tab === 'card' && (
        <div className={f.field} style={{ alignItems: 'center' }}>
          {busy && <p>{C.making}</p>}
          {card && <><QrSvg text={card.link} label={C.qrLabel} /><CopyField id="cc-link" label={C.link} value={card.link} /><CopyField id="cc-code" label={C.code} value={card.code} /></>}
          <p className={f.note}>{C.cardNote}</p>
        </div>
      )}
      {tab === 'add' && (
        <div className={f.field}>
          <label className={f.label} htmlFor="cc-add">{C.pasteLabel}</label>
          <input id="cc-add" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          <div className={f.actions}><button type="button" className="btn btn-primary" disabled={!code.trim() || busy} onClick={() => { void add(); }}>{C.addAndChat}</button></div>
        </div>
      )}
    </Dialog>
  );
}

/** E-014: both DM peers derive the same six groups of digits from their key pair. */
function SafetyNumber({ peer, peerName, me }: { peer: string; peerName: string; me: string }) {
  const [value, setValue] = useState('');
  useEffect(() => { let live = true; void safetyNumber(me, peer).then((n) => { if (live) setValue(n); }); return () => { live = false; }; }, [me, peer]);
  return (
    <div className={f.field}>
      <span className={f.label} id="safety-num-label">{COPY.safetyNumber}</span>
      <code className={x.code} aria-labelledby="safety-num-label">{value || COPY.safetyComputing}</code>
      <p className={f.note}>{COPY.safetyNote(peerName)}</p>
    </div>
  );
}
