import type { ViewModel } from '@/state/viewModel';
import s from './Intro.module.css';
import { COPY } from '@/config/copy';

export function Intro({ vm }: { vm: ViewModel }) {
  const { introOn } = vm;
  return introOn ? (
    <div className={s.root}>
      <div>
        <div className={s.title}>{COPY.ui.shell.introText.hermóðr}</div>
        <div className={s.subtitle}>{COPY.ui.shell.introText.aMessengerForEverythingYou}</div>
      </div>
    </div>
  ) : null;
}
