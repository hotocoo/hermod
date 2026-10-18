import type { StateCreator } from 'zustand';
import { SKY_DARK_THRESHOLD, TIMING, CAMERA } from '../../config/app';
import { getTown } from '../townPort';
import { timer } from '../timers';
import type { AppStore, SceneSlice } from '../types';

export const createSceneSlice: StateCreator<AppStore, [], [], SceneSlice> = (set, get) => ({
  ready: false, town: 'loading', hot: null, photo: false, archi: false, veil: 0, flash: 0, intro: true, themeBySky: false,

  setTownStatus: (town) => set({ town }),
  setHot: (hot) => set({ hot }),
  hoverBuilding: (id) => getTown()?.hover(id),

  onSky: (sky) => {
    set({ hour: sky.hour, period: sky.period, night: sky.night });
    const s = get();
    if (!s.skyTheme || !s.ready) return;
    const dark = sky.night > SKY_DARK_THRESHOLD;
    if (dark !== (s.theme === 'dark')) set({ themeBySky: true, theme: dark ? 'dark' : 'light' });
  },

  onFlash: () => {
    set({ flash: Date.now() });
    timer.after('flash', TIMING.flashRefreshMs, () => get().forceUpdate());
  },

  togglePhoto: () => {
    const s = get(); const on = !s.photo; const town = getTown();
    if (on && s.inside) s.exit();
    set({ photo: on, drawer: null, archi: on ? false : s.archi });
    if (town) {
      if (on && s.archi) town.setArchipelago(false);
      town.setPhoto(on);
    }
  },

  toggleArchi: () => {
    const s = get(); const on = !s.archi; const town = getTown();
    if (on && s.inside) s.exit();
    if (on && s.photo) town?.setPhoto(false);
    set({ archi: on, photo: false, drawer: null });
    town?.setArchipelago(on, s.spaces.map((x) => ({ id: x.id, name: x.name, sections: x.sections.slice() })));
  },

  replayIntro: () => {
    set({ drawer: null, intro: true });
    timer.after('intro', TIMING.introMs, () => set({ intro: false }));
    getTown()?.recenter();
  },

  recenter: () => getTown()?.recenter(),
  zoomIn: () => getTown()?.zoomBy(-CAMERA.zoomStep),
  zoomOut: () => getTown()?.zoomBy(CAMERA.zoomStep),
  rotL: () => getTown()?.rotateBy(CAMERA.rotateStep),
  rotR: () => getTown()?.rotateBy(-CAMERA.rotateStep),
});
