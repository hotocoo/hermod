import type { Page } from '@playwright/test';
import { GL_ARGS } from './gpu';
import { test, expect, bootApp, enterSection, toIsland, DEVHOST_A } from './fixtures';
import { freshDevhosts } from './devhosts';

/**
 * X-007: text scaled to 200% at 1440x900 clips nothing on the main surfaces. The scale is applied the way a
 * returning user has it (the stored setting, read at boot); the surfaces are the town HUD, the chat, every
 * panel page and the App settings dialog. "Clipped" means a box that hides its overflow while its content is
 * bigger than it, or anything pushed past the right edge of the window (the page never scrolls sideways).
 */
test.use({ launchOptions: { args: GL_ARGS } });
test.beforeAll(async () => { test.setTimeout(180_000); await freshDevhosts(); });

const SCALE_PERCENT = 200;
const SCALE_KEY = 'hermodr.textScale';
/** Sub-pixel rounding between layout and scroll metrics. */
const TOLERANCE_PX = 2;
const PAGES = ['chat', 'hearth', 'feed', 'board', 'skein', 'desk'] as const;

/** Describes every clipped box and every box past the right edge, empty when the surface fits. */
async function clipped(page: Page): Promise<string[]> {
  // Entrances (the toast that announces a raised plot, a sliding panel) finish first: mid-flight they sit partly outside the window.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  return page.evaluate((tol) => {
    const found: string[] = [];
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + tol) found.push(`page scrolls sideways: ${doc.scrollWidth} > ${doc.clientWidth}`);
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // Hidden, collapsed, screen-reader-only and canvas boxes carry no readable text.
      if (cs.display === 'none' || cs.visibility === 'hidden' || box.width <= tol || box.height <= tol || el.tagName === 'CANVAS') continue;
      if (!(el.textContent ?? '').trim()) continue;
      // An ellipsis is an intentional, announced truncation (the full text is in the title), not a clip.
      const hides = (v: string) => v === 'hidden' || v === 'clip';
      // Content parked wholly outside the box (the closed thread pane, projected labels of buildings off screen) is off-canvas by design;
      // clipped means text that overlaps the box and is cut at its edge.
      // A transparent label (the building labels fade out while a panel is open) shows nothing either.
      const faded = (c: Element) => { for (let n: Element | null = c; n && n !== el; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return true; return false; };
      const cutText = () => [...el.querySelectorAll('*')].some((c) => {
        // Building labels are projected from the 3D scene by the camera, so where they sit follows the island, not the layout.
        if (faded(c) || c.closest('[data-bld]')) return false;
        if (![...c.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())) return false;
        const r = c.getBoundingClientRect();
        const overlaps = r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
        return overlaps && (r.right > box.right + tol || r.bottom > box.bottom + tol || r.left < box.left - tol || r.top < box.top - tol);
      });
      if (cs.textOverflow !== 'ellipsis' && ((hides(cs.overflowX) && el.scrollWidth > el.clientWidth + tol) || (hides(cs.overflowY) && el.scrollHeight > el.clientHeight + tol)) && cutText()) {
        found.push(`clipped ${name(el)}: ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
      }
      // Text with no children of its own that sits past the window edge is cut off by the viewport.
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim());
      if (ownText && box.right > window.innerWidth + tol && cs.position !== 'fixed') found.push(`past the right edge ${name(el)}: ${Math.round(box.right)} > ${window.innerWidth}`);
    }
    return found;
  }, TOLERANCE_PX);
}

test('text at 200% clips nothing on the town HUD, chat, panel pages and App settings (X-007)', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* storage blocked: the default scale shows */ } }, [SCALE_KEY, String(SCALE_PERCENT)]);
  await bootApp(page, DEVHOST_A, 'Ada Tester');

  // The stored setting reached the root: 200% of the 16px browser default.
  await expect(page.locator('html')).toHaveCSS('font-size', `${(16 * SCALE_PERCENT) / 100}px`);

  // Town HUD: header, top bar, rail and the bottom controls.
  expect(await clipped(page), 'town HUD').toEqual([]);

  // Chat and every other panel page.
  for (const section of PAGES) {
    await expect(async () => { await enterSection(page, section); }).toPass({ timeout: 90_000 });
    expect(await clipped(page), `${section} page`).toEqual([]);
  }

  // App settings: the dialog offers 200% and fits at it.
  await toIsland(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: /Settings/ }).getByRole('button', { name: 'App settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await expect(dialog.getByLabel('Text size')).toHaveValue(String(SCALE_PERCENT));
  expect(await clipped(page), 'App settings dialog').toEqual([]);
});
