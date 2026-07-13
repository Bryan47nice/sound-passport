import { expect, type Page } from '@playwright/test';

const visibleElementSelector = [
  '.app-shell',
  '.app-header',
  '.app-navigation',
  '.page',
  '.world-map',
  '.country-index',
  '.journey-list',
  '.journey-detail-actions',
  '.moment-list',
  '.player-stage',
  '.player-visual',
  '.player-copy',
  '.player-controls',
  '.studio-guidance',
  '.studio-page',
  '.studio-heading',
  '.studio-toolbar',
  '.studio-tabs',
  '.studio-panel',
  '.studio-table-wrap',
  '.journey-create-page',
  '.journey-create-form',
  '.journey-editor-page',
  '.journey-editor-header',
  '.journey-overview-region',
  '.journey-editor-workspace',
  '.journey-moment-list',
  '.journey-moment-preview',
  '.moment-details-region',
  '.journey-preview-page',
  '.journey-preview-header',
  '.journey-preview-moment',
  '.journey-preview-visual',
  '.journey-preview-copy',
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'img',
  'iframe',
  'h1',
  'h2',
  'h3',
  'p',
  'span',
  'strong',
  'small',
  'time',
].join(',');

export async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate((selector) => {
    const viewportWidth = document.documentElement.clientWidth;
    const tolerance = 1;
    const elements = [...document.querySelectorAll<HTMLElement>(selector)];
    const label = (element: HTMLElement) => {
      const text = element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;
      const classes = element.className && typeof element.className === 'string'
        ? `.${element.className.trim().replace(/\s+/g, '.')}`
        : '';
      return `${element.tagName.toLowerCase()}${classes} (${text.slice(0, 80)})`;
    };
    const clippedBounds = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      let left = rect.left;
      let right = rect.right;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if (!['auto', 'clip', 'hidden', 'scroll'].includes(overflowX)) continue;
        const ancestorRect = ancestor.getBoundingClientRect();
        left = Math.max(left, ancestorRect.left);
        right = Math.min(right, ancestorRect.right);
      }
      return { left, right };
    };
    const outside = elements.flatMap((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.visibility === 'hidden'
        || style.display === 'none'
        || style.opacity === '0'
        || rect.width === 0
        || rect.height === 0
      ) return [];
      const visible = clippedBounds(element);
      if (visible.right <= visible.left) return [];
      if (visible.left >= -tolerance && visible.right <= viewportWidth + tolerance) return [];
      return [`${label(element)}: visible horizontal bounds ${visible.left.toFixed(1)}..${visible.right.toFixed(1)} exceed viewport 0..${viewportWidth}`];
    });

    return {
      bodyScrollWidth: document.body.scrollWidth,
      outside,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
    };
  }, visibleElementSelector);

  expect(
    layout.scrollWidth,
    `document scrollWidth ${layout.scrollWidth} exceeds viewport ${layout.viewportWidth}`,
  ).toBeLessThanOrEqual(layout.viewportWidth);
  expect(
    layout.bodyScrollWidth,
    `body scrollWidth ${layout.bodyScrollWidth} exceeds viewport ${layout.viewportWidth}`,
  ).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.outside, layout.outside.join('\n')).toEqual([]);
}

export async function expectNoObviousOverlap(page: Page) {
  const overlaps = await page.evaluate((selector) => {
    const candidates = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden'
          && style.display !== 'none'
          && style.opacity !== '0'
          && rect.width > 0
          && rect.height > 0;
      });

    const labels = (element: HTMLElement) => (
      element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 60) || element.tagName
    );
    const issues: string[] = [];
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        const first = candidates[left];
        const second = candidates[right];
        if (first.contains(second) || second.contains(first)) continue;
        const a = first.getBoundingClientRect();
        const b = second.getBoundingClientRect();
        const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const overlapArea = overlapWidth * overlapHeight;
        const smallerArea = Math.min(a.width * a.height, b.width * b.height);
        if (overlapArea <= 36 || overlapArea / smallerArea < 0.08) continue;
        issues.push(`${labels(first)} overlaps ${labels(second)}`);
      }
    }
    return issues;
  }, 'a, button, input, select, textarea, label, h1, h2, h3, p, time, img, iframe');

  expect(overlaps, overlaps.join('\n')).toEqual([]);
}

export async function verifyRouteLayout(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoObviousOverlap(page);
}
