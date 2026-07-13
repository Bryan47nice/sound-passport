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
