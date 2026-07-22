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
  const overlaps = await page.evaluate(() => {
    const pixelTolerance = 2;
    const clippingValues = new Set(['auto', 'clip', 'hidden', 'scroll']);
    const viewport = {
      bottom: document.documentElement.clientHeight,
      left: 0,
      right: document.documentElement.clientWidth,
      top: 0,
    };
    type Bounds = typeof viewport;
    type CandidateKind = 'control' | 'media' | 'text';
    type Candidate = {
      bounds: Bounds;
      kind: CandidateKind;
      label: string;
      owner: Element;
    };

    const isVisible = (element: Element) => {
      for (let current: Element | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.visibility === 'collapse'
          || Number.parseFloat(style.opacity) === 0
          || current.getAttribute('aria-hidden') === 'true'
        ) return false;
      }
      return true;
    };
    const clipToVisibleBounds = (rect: DOMRect, owner: Element) => {
      const bounds = { ...viewport };
      bounds.left = Math.max(bounds.left, rect.left);
      bounds.right = Math.min(bounds.right, rect.right);
      bounds.top = Math.max(bounds.top, rect.top);
      bounds.bottom = Math.min(bounds.bottom, rect.bottom);

      for (let current: Element | null = owner; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        const currentRect = current.getBoundingClientRect();
        if (clippingValues.has(style.overflowX)) {
          bounds.left = Math.max(bounds.left, currentRect.left);
          bounds.right = Math.min(bounds.right, currentRect.right);
        }
        if (clippingValues.has(style.overflowY)) {
          bounds.top = Math.max(bounds.top, currentRect.top);
          bounds.bottom = Math.min(bounds.bottom, currentRect.bottom);
        }
      }

      return bounds.right - bounds.left > pixelTolerance
        && bounds.bottom - bounds.top > pixelTolerance
        ? bounds
        : undefined;
    };
    const elementLabel = (element: Element) => {
      const classes = typeof element.className === 'string' && element.className.trim()
        ? `.${element.className.trim().replace(/\s+/g, '.')}`
        : '';
      const text = element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;
      return `${element.tagName.toLowerCase()}${classes} (${text.slice(0, 60)})`;
    };
    const candidates: Candidate[] = [];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const textNode = node as Text;
      const owner = textNode.parentElement;
      const start = textNode.data.search(/\S/);
      const end = textNode.data.search(/\s*$/);
      if (!owner || start < 0 || end <= start || !isVisible(owner)) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(owner.tagName)) continue;

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      for (const rect of range.getClientRects()) {
        const bounds = clipToVisibleBounds(rect, owner);
        if (bounds) {
          candidates.push({
            bounds,
            kind: 'text',
            label: `text (${textNode.data.slice(start, end).replace(/\s+/g, ' ').slice(0, 60)})`,
            owner,
          });
        }
      }
      range.detach();
    }

    const controlSelector = [
      'a',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="link"]',
      '[role="option"]',
      '[role="tab"]',
    ].join(',');
    const mediaSelector = [
      'audio',
      'canvas',
      'iframe',
      'img',
      'svg',
      'video',
    ].join(',');
    const controlAndMediaSelector = `${controlSelector},${mediaSelector}`;
    for (const element of document.querySelectorAll<Element>(controlAndMediaSelector)) {
      if (!isVisible(element)) continue;
      const bounds = clipToVisibleBounds(element.getBoundingClientRect(), element);
      if (bounds) {
        candidates.push({
          bounds,
          kind: element.matches(controlSelector) ? 'control' : 'media',
          label: elementLabel(element),
          owner: element,
        });
      }
    }

    const isControlWithOwnRepresentation = (control: Candidate, representation: Candidate) => (
      control.kind === 'control'
      && control.owner.contains(representation.owner)
    );

    const isIntentionalOverlay = (first: Candidate, second: Candidate) => {
      const matchingPair = (mediaSelector: string, overlaySelector: string, containerSelector: string) => {
        const media = first.owner.matches(mediaSelector) ? first.owner
          : second.owner.matches(mediaSelector) ? second.owner : undefined;
        const overlayCandidate = media === first.owner ? second.owner : first.owner;
        const overlay = overlayCandidate.closest(overlaySelector);
        return Boolean(
          media
          && overlay
          && media.closest(containerSelector) === overlay.closest(containerSelector),
        );
      };

      // Player and preview captions deliberately sit on their matching photo.
      if (matchingPair('.player-visual > .player-photo', '.player-visual > figcaption', '.player-visual')) return true;
      if (
        matchingPair(
          '.journey-preview-visual > .journey-preview-photo',
          '.journey-preview-visual > figcaption',
          '.journey-preview-visual',
        )
      ) return true;

      // MapLibre deliberately stacks its own markers and controls over the map canvas.
      return matchingPair(
        '.world-map .maplibregl-canvas',
        '.world-map .maplibregl-marker, .world-map .maplibregl-control-container',
        '.world-map',
      );
    };

    candidates.sort((left, right) => left.bounds.left - right.bounds.left);
    const issues: string[] = [];
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        const first = candidates[left];
        const second = candidates[right];
        if (second.bounds.left >= first.bounds.right - pixelTolerance) break;
        if (
          isControlWithOwnRepresentation(first, second)
          || isControlWithOwnRepresentation(second, first)
        ) continue;
        if (isIntentionalOverlay(first, second)) continue;
        const overlapWidth = Math.min(first.bounds.right, second.bounds.right)
          - Math.max(first.bounds.left, second.bounds.left);
        const overlapHeight = Math.min(first.bounds.bottom, second.bounds.bottom)
          - Math.max(first.bounds.top, second.bounds.top);
        if (overlapWidth <= pixelTolerance || overlapHeight <= pixelTolerance) continue;
        issues.push(
          `${first.label} overlaps ${second.label} by ${overlapWidth.toFixed(1)}x${overlapHeight.toFixed(1)}px`,
        );
      }
    }
    return issues;
  });

  expect(overlaps, overlaps.join('\n')).toEqual([]);
}

export async function verifyRouteLayout(page: Page) {
  await expectNoHorizontalOverflow(page);
  await expectNoObviousOverlap(page);
}
