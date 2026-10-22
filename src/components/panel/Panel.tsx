'use client';
import dynamic from 'next/dynamic';
import { useViewModel } from '@/state/useViewModel';
import { ChatSection } from '@/components/chat/ChatSection';
import { HearthSection } from '@/components/sections/HearthSection';
import { FeedSection } from '@/components/sections/FeedSection';
import { BoardSection } from '@/components/sections/BoardSection';
import { SkeinSection } from '@/components/sections/SkeinSection';
import { PanelHeader } from './PanelHeader';
import { SubTabs } from './SubTabs';
import { EmptyPlot, FreshBuilt } from './EmptyStates';
import { Watch } from './pages/Watch';
import { Live } from './pages/Live';
import { Stories } from './pages/Stories';
import { Pinboards } from './pages/Pinboards';
import { Docs } from './pages/Docs';
import { Calendar } from './pages/Calendar';
/** The arcade bundle (lobby and every game renderer) loads on first entry. */
const ArcadeSection = dynamic(() => import('@/components/arcade/ArcadeSection'), { ssr: false });
import s from './panel.module.css';

/** The desk bundle (list, detail, forms) loads on first entry so the initial JS stays small. */
const DeskSection = dynamic(() => import('@/components/desk/DeskSection'), { ssr: false });

/** The inside panel: header, sub tabs and the page for the current section. */
export function Panel() {
  const vm = useViewModel();
  if (!vm.ready) return null;
  return (
    <section aria-label={vm.panelTitle} className={s.panel} inert={!vm.inside}
      style={{ width: vm.panelW, clipPath: vm.panelClip, pointerEvents: vm.panelEvents as 'auto' | 'none' }}>
      <PanelHeader vm={vm} />
      <div className={s.body}>
        {vm.panelReady && (
          <div className={s.iris}>
            {vm.subTabsOn && <SubTabs vm={vm} />}
            {vm.pgWatch && <Watch vm={vm} />}
            {vm.pgLive && <Live vm={vm} />}
            {vm.pgStories && <Stories vm={vm} />}
            {vm.pgBoards && <Pinboards vm={vm} />}
            {vm.pgDocs && <Docs vm={vm} />}
            {vm.pgCal && <Calendar vm={vm} />}
            {vm.isChat && <ChatSection vm={vm} />}
            {vm.isHearthOk && <HearthSection />}
            {vm.isFeedOk && <FeedSection />}
            {vm.isBoardOk && <BoardSection />}
            {vm.isSkeinOk && <SkeinSection />}
            {vm.isDeskOk && <DeskSection />}
            {vm.isArcadeOk && <ArcadeSection />}
            {vm.plotEmpty && <EmptyPlot vm={vm} />}
            {vm.freshBuilt && <FreshBuilt vm={vm} />}
          </div>
        )}
      </div>
    </section>
  );
}
