import { expect, test } from '@playwright/test';
import { expectNoObviousOverlap } from './layoutAssertions';

test('detects completely overlapping sibling span text', async ({ page }) => {
  await page.setContent(`
    <div style="position: relative; width: 180px; height: 24px">
      <span style="position: absolute; inset: 0">First sibling label</span>
      <span style="position: absolute; inset: 0">Second sibling label</span>
    </div>
  `);

  await expect(expectNoObviousOverlap(page)).rejects.toThrow(/overlaps/);
});

test('detects a 10px visible text collision between 180x100 paragraphs', async ({ page }) => {
  await page.setContent(`
    <div style="position: relative; width: 350px; height: 100px">
      <p style="position: absolute; left: 0; top: 0; width: 180px; height: 100px; margin: 0; overflow: hidden; white-space: nowrap; font: 16px/20px monospace">
        MMMMMMMMMMMMMMMMMMMMMMMM
      </p>
      <p style="position: absolute; left: 170px; top: 0; width: 180px; height: 100px; margin: 0; overflow: hidden; white-space: nowrap; font: 16px/20px monospace">
        NNNNNNNNNNNNNNNNNNNNNNNN
      </p>
    </div>
  `);

  await expect(expectNoObviousOverlap(page)).rejects.toThrow(/overlaps/);
});

test('detects a button label overlapping its descendant svg', async ({ page }) => {
  await page.setContent(`
    <div style="padding: 40px">
      <button
        id="overlapping-control"
        style="position: relative; display: block; width: 120px; height: 24px; padding: 0; border: 0; font-family: monospace; font-size: 19px; line-height: 20px; text-align: left"
      >LABEL1234<svg aria-label="Embedded icon" style="position: absolute; left: 0; top: 2px; width: 91px; height: 20px"></svg></button>
    </div>
  `);

  const collision = await page.evaluate(() => {
    const button = document.querySelector('#overlapping-control') as HTMLButtonElement;
    const svg = button.querySelector('svg') as SVGElement;
    const label = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) as Text;
    const range = document.createRange();
    range.selectNodeContents(label);
    const labelRect = range.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    range.detach();
    return {
      height: Math.min(labelRect.bottom, svgRect.bottom) - Math.max(labelRect.top, svgRect.top),
      ownerContainsSvg: label.parentElement === button && button.contains(svg),
      width: Math.min(labelRect.right, svgRect.right) - Math.max(labelRect.left, svgRect.left),
    };
  });

  expect(collision.ownerContainsSvg).toBe(true);
  expect(collision.width).toBeGreaterThan(89);
  expect(collision.width).toBeLessThan(93);
  expect(collision.height).toBeGreaterThan(18);
  expect(collision.height).toBeLessThanOrEqual(20);
  await expect(expectNoObviousOverlap(page)).rejects.toThrow(/text \(LABEL1234\) overlaps svg/);
});

test('detects overlapping text-node line rects owned by one paragraph', async ({ page }) => {
  await page.setContent(`
    <div style="padding: 40px">
      <p id="overlapping-lines" style="width: 180px; margin: 0; font-family: monospace; font-size: 21.5px; line-height: 0; white-space: nowrap">MMMMMMMMMMMMMM<br>NNNNNNNNNNNNNN</p>
    </div>
  `);

  const collision = await page.evaluate(() => {
    const paragraph = document.querySelector('#overlapping-lines') as HTMLParagraphElement;
    const lines = [...paragraph.childNodes].filter((node): node is Text => (
      node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    ));
    const rects = lines.map((line) => {
      const range = document.createRange();
      range.selectNodeContents(line);
      const rect = range.getBoundingClientRect();
      range.detach();
      return rect;
    });
    return {
      height: Math.min(rects[0].bottom, rects[1].bottom) - Math.max(rects[0].top, rects[1].top),
      sameOwner: lines.length === 2 && lines.every((line) => line.parentElement === paragraph),
      width: Math.min(rects[0].right, rects[1].right) - Math.max(rects[0].left, rects[1].left),
    };
  });

  expect(collision.sameOwner).toBe(true);
  expect(collision.width).toBeGreaterThan(151);
  expect(collision.width).toBeLessThan(156);
  expect(collision.height).toBeGreaterThanOrEqual(21);
  expect(collision.height).toBeLessThan(24);
  await expect(expectNoObviousOverlap(page)).rejects.toThrow(/text \(MMMMMMMMMMMMMM\) overlaps text \(NNNNNNNNNNNNNN\)/);
});

test('allows a control rectangle containing its own separated text and svg', async ({ page }) => {
  await page.setContent(`
    <button
      id="normal-control"
      style="display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 16px; line-height: 20px"
    ><svg aria-label="Save icon" style="width: 20px; height: 20px"></svg>Save journey</button>
  `);

  const geometry = await page.evaluate(() => {
    const button = document.querySelector('#normal-control') as HTMLButtonElement;
    const svg = button.querySelector('svg') as SVGElement;
    const label = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) as Text;
    const range = document.createRange();
    range.selectNodeContents(label);
    const labelRect = range.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    range.detach();
    return {
      labelOwnedByControl: label.parentElement === button,
      svgIsDescendant: button.contains(svg),
      textMediaGap: labelRect.left - svgRect.right,
    };
  });

  expect(geometry.labelOwnedByControl).toBe(true);
  expect(geometry.svgIsDescendant).toBe(true);
  expect(geometry.textMediaGap).toBeGreaterThan(2);
  await expectNoObviousOverlap(page);
});

test('allows visible sibling text with separate bounds', async ({ page }) => {
  await page.setContent(`
    <div style="display: flex; gap: 24px">
      <span>First sibling label</span>
      <span>Second sibling label</span>
    </div>
  `);

  await expectNoObviousOverlap(page);
});

test('allows text contained by ancestor elements', async ({ page }) => {
  await page.setContent(`
    <p><span><strong><small>Nested text remains one visible text run</small></strong></span></p>
  `);

  await expectNoObviousOverlap(page);
});
