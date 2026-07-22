import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { deflateSync, inflateSync } from 'node:zlib';
import { defaultE2eUser, setE2eUser } from './helpers/auth';
import { verifyRouteLayout } from './helpers/layoutAssertions';
import { makePng } from './helpers/testImages';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  let stage = 'setup';

  page.on('pageerror', (error) => {
    errors.push(`[${stage}] pageerror: ${error.stack || error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${stage}] console: ${message.text()}`);
  });

  return {
    errors,
    setStage(nextStage: string) {
      stage = nextStage;
    },
  };
}

async function expectLoadedFixtureImages(page: Page) {
  await expect.poll(() => page.locator('img').evaluateAll((images) => (
    images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0)
  ))).toBe(true);
}

function paethPredictor(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function screenshotMetrics(png: Buffer) {
  if (png.length < pngSignature.length || !png.subarray(0, 8).equals(pngSignature)) {
    throw new Error('Expected a PNG signature');
  }

  const chunks: Buffer[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;

  while (offset < png.length) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + length + 12;
    if (chunkEnd > png.length) throw new Error('Truncated PNG chunk data');
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset = chunkEnd;

    if (type === 'IHDR') {
      if (length !== 13) throw new Error('Invalid PNG IHDR length');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      if (width === 0 || height === 0 || data[8] !== 8 || ![2, 6].includes(colorType)
        || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Expected a non-interlaced 8-bit RGB or RGBA PNG');
      }
      bytesPerPixel = colorType === 2 ? 3 : 4;
    }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') break;
  }

  if (!width || !height || !bytesPerPixel || chunks.length === 0) {
    throw new Error('PNG is missing IHDR or IDAT data');
  }

  const rowSize = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(chunks));
  const expectedLength = height * (rowSize + 1);
  if (raw.length !== expectedLength) {
    throw new Error(`Unexpected PNG data length: expected ${expectedLength}, received ${raw.length}`);
  }

  const previous = Buffer.alloc(rowSize);
  const colors = new Set<number>();
  let nearBlackPixels = 0;
  let inputOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = raw[inputOffset++];
    if (filter > 4) throw new Error(`Unsupported PNG filter ${filter}`);
    const current = Buffer.from(raw.subarray(inputOffset, inputOffset + rowSize));
    inputOffset += rowSize;

    for (let byte = 0; byte < rowSize; byte += 1) {
      const left = byte >= bytesPerPixel ? current[byte - bytesPerPixel] : 0;
      const above = previous[byte];
      const upperLeft = byte >= bytesPerPixel ? previous[byte - bytesPerPixel] : 0;
      if (filter === 1) current[byte] = (current[byte] + left) & 0xff;
      if (filter === 2) current[byte] = (current[byte] + above) & 0xff;
      if (filter === 3) current[byte] = (current[byte] + Math.floor((left + above) / 2)) & 0xff;
      if (filter === 4) current[byte] = (current[byte] + paethPredictor(left, above, upperLeft)) & 0xff;
    }

    for (let pixel = 0; pixel < width; pixel += 1) {
      const byte = pixel * bytesPerPixel;
      const red = current[byte];
      const green = current[byte + 1];
      const blue = current[byte + 2];
      const alpha = bytesPerPixel === 4 ? current[byte + 3] : 255;
      colors.add((red << 16) | (green << 8) | blue);
      const opacity = alpha / 255;
      const compositedRed = Math.round(red * opacity);
      const compositedGreen = Math.round(green * opacity);
      const compositedBlue = Math.round(blue * opacity);
      if (compositedRed <= 4 && compositedGreen <= 4 && compositedBlue <= 4) nearBlackPixels += 1;
    }
    current.copy(previous);
  }

  return {
    colorCount: colors.size,
    nearBlackPixelRatio: nearBlackPixels / (width * height),
  };
}

function pngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  return chunk;
}

function filteredPng(colorType: 2 | 6, filter: number) {
  const bytesPerPixel = colorType === 2 ? 3 : 4;
  const rgbRows = [
    [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
    [[255, 0, 0], [255, 255, 255], [0, 0, 0]],
  ];
  const rows = rgbRows.map((row, rowIndex) => Buffer.from(row.flatMap((rgb, pixelIndex) => (
    colorType === 2 ? rgb : [...rgb, rowIndex === 0 && pixelIndex === 1
      ? 0
      : 255 - (rowIndex * 3 + pixelIndex) * 32]
  ))));
  const encodedRows: Buffer[] = [];
  const previous = Buffer.alloc(rows[0].length);

  for (const row of rows) {
    const encoded = Buffer.alloc(row.length + 1);
    encoded[0] = filter;
    for (let byte = 0; byte < row.length; byte += 1) {
      const left = byte >= bytesPerPixel ? row[byte - bytesPerPixel] : 0;
      const above = previous[byte];
      const upperLeft = byte >= bytesPerPixel ? previous[byte - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      encoded[byte + 1] = (row[byte] - predictor + 256) & 0xff;
    }
    encodedRows.push(encoded);
    row.copy(previous);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(3, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = colorType;
  return Buffer.concat([
    pngSignature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(encodedRows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function expectMapScreenshotVariance(page: Page, path: string, projectName: string, state: 'initial' | 'remount') {
  const map = page.getByLabel('旅行世界地圖');
  const canvas = map.locator('canvas');
  await expect(map).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  await expect(canvas).toBeVisible();
  const metrics = screenshotMetrics(await canvas.screenshot());
  expect(metrics.colorCount).toBeGreaterThan(512);
  expect(metrics.nearBlackPixelRatio).toBeLessThan(0.005);
  await expect(canvas).toHaveScreenshot(`atlas-map-${state}-${projectName}.png`, {
    maxDiffPixelRatio: 0.0005,
  });
  await canvas.screenshot({ path });
}

async function expectNonBlankMapCanvas(page: Page) {
  const map = page.locator('.world-map');
  const canvas = map.locator('canvas');
  await expect(map).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  await expect(canvas).toBeVisible();
  const metrics = screenshotMetrics(await canvas.screenshot());
  expect(metrics.colorCount).toBeGreaterThan(512);
  expect(metrics.nearBlackPixelRatio).toBeLessThan(0.005);
}

async function expectEastAsiaMarkerPlacement(page: Page) {
  const mapBox = await page.getByLabel('旅行世界地圖').boundingBox();
  const japanBox = await page.getByRole('button', { name: '日本，2 趟旅程' }).boundingBox();
  const koreaBox = await page.getByRole('button', { name: '韓國，1 趟旅程' }).boundingBox();
  expect(mapBox).not.toBeNull();
  expect(japanBox).not.toBeNull();
  expect(koreaBox).not.toBeNull();
  if (!mapBox || !japanBox || !koreaBox) return;

  const japanCenter = { x: japanBox.x + japanBox.width / 2, y: japanBox.y + japanBox.height / 2 };
  const koreaCenter = { x: koreaBox.x + koreaBox.width / 2, y: koreaBox.y + koreaBox.height / 2 };
  for (const markerBox of [japanBox, koreaBox]) {
    expect(markerBox.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(markerBox.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
    expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);
  }
  expect(japanCenter.x).toBeGreaterThan(mapBox.x + mapBox.width / 2);
  expect(japanCenter.x).toBeLessThan(mapBox.x + mapBox.width);
  expect(japanCenter.y).toBeGreaterThan(mapBox.y + mapBox.height * 0.2);
  expect(japanCenter.y).toBeLessThan(mapBox.y + mapBox.height * 0.8);
  expect(koreaCenter.x).toBeGreaterThan(mapBox.x);
  expect(koreaCenter.x).toBeLessThan(mapBox.x + mapBox.width);
  expect(koreaCenter.y).toBeGreaterThan(mapBox.y + mapBox.height * 0.2);
  expect(koreaCenter.y).toBeLessThan(mapBox.y + mapBox.height * 0.8);
  expect(japanCenter.x).toBeGreaterThan(koreaCenter.x);
  expect(Math.hypot(japanCenter.x - koreaCenter.x, japanCenter.y - koreaCenter.y)).toBeLessThan(100);
  const overlapWidth = Math.max(0, Math.min(japanBox.x + japanBox.width, koreaBox.x + koreaBox.width) - Math.max(japanBox.x, koreaBox.x));
  const overlapHeight = Math.max(0, Math.min(japanBox.y + japanBox.height, koreaBox.y + koreaBox.height) - Math.max(japanBox.y, koreaBox.y));
  expect(overlapWidth * overlapHeight).toBe(0);
}

test('decodes RGB and RGBA screenshots across all PNG filters', () => {
  for (const colorType of [2, 6] as const) {
    for (let filter = 0; filter <= 4; filter += 1) {
      const metrics = screenshotMetrics(filteredPng(colorType, filter));
      expect(metrics.colorCount).toBe(5);
      expect(metrics.nearBlackPixelRatio).toBeCloseTo(colorType === 6 ? 2 / 6 : 1 / 6, 6);
    }
  }
});

test('copies a fixture journey into an editable private draft', async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Journey editing is intentionally desktop-only.');
  const diagnostics = collectPageErrors(page);
  const fixturePhoto = makePng(320, 180, [33, 91, 104]);
  await page.route('https://images.unsplash.com/**', (route) => route.fulfill({
    body: fixturePhoto,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
  }));

  await page.goto('/');
  await setE2eUser(page, defaultE2eUser);
  await expect(page.locator('.account-menu')).toBeVisible();

  diagnostics.setStage('fixture detail');
  await page.goto('/demo/journeys/seoul-2025');
  await expect(page.locator('.brand-passport-mark')).toBeVisible();
  await expect(page.getByText('示範旅程', { exact: true })).toBeVisible();
  await verifyRouteLayout(page);

  diagnostics.setStage('fixture copy');
  await page.getByRole('button', { name: '複製成我的旅程' }).click();
  await expect(page).toHaveURL(/\/studio\/journeys\/[^/]+$/);
  await expect(page.getByRole('heading', { level: 1, name: '首爾，十月的夜（副本）' })).toBeVisible();

  const journeyRegion = page.getByRole('region', { name: '旅程資料' });
  await expect(journeyRegion.getByLabel('旅程標題')).toHaveValue('首爾，十月的夜（副本）');
  await expect(journeyRegion.getByLabel('旅程總文（選填）')).toHaveValue('沿著漢江與街道收集夜裡的節奏。');
  const rows = page.getByRole('region', { name: '時刻清單' }).getByRole('listitem');
  await expect(rows).toHaveCount(1);

  const momentRegion = page.getByRole('region', { name: '時刻資料' });
  await expect(momentRegion.getByLabel('城市', { exact: true })).toHaveValue('首爾');
  await expect(momentRegion.getByLabel('地點', { exact: true })).toHaveValue('漢江公園');
  await expect(momentRegion.getByLabel('時刻文案')).toHaveValue('風吹過河面。');
  await expect(momentRegion.getByLabel('歌名', { exact: true })).toHaveValue('Han River Night');
  await expect(momentRegion.getByLabel('歌手', { exact: true })).toHaveValue('Sound Passport Demo');
  await expect(momentRegion.getByLabel('選歌原因')).toHaveValue('風吹過河面時，城市的聲音退到了後面。');
  await expect(page.locator('.journey-editor-preview-image')).toHaveJSProperty('naturalWidth', 320);
  await expect(page.locator('.journey-editor-preview-image')).toHaveJSProperty('naturalHeight', 180);
  await verifyRouteLayout(page);
  expect(diagnostics.errors, diagnostics.errors.join('\n')).toEqual([]);
});

test('keeps fixture copying desktop-only on mobile', async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This scenario runs only in the mobile project.');

  await page.goto('/journeys/seoul-2025');

  await expect(page.getByText('示範旅程', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '複製成我的旅程' })).toHaveCount(0);
  await verifyRouteLayout(page);
});

test('revisits a journey from the map without autoplay', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(90_000);
  const diagnostics = collectPageErrors(page);

  diagnostics.setStage('initial mount before screenshot');
  await page.goto('/');
  await expect(page.getByLabel('旅行世界地圖')).toBeVisible();
  expect(diagnostics.errors).toEqual([]);
  await expectMapScreenshotVariance(page, testInfo.outputPath('atlas-map-initial.png'), testInfo.project.name, 'initial');
  await expectEastAsiaMarkerPlacement(page);
  await verifyRouteLayout(page);
  diagnostics.setStage('initial mount after screenshot');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(diagnostics.errors).toEqual([]);

  diagnostics.setStage('country route');
  await page.getByRole('button', { name: '日本，2 趟旅程' }).click();
  await expect(page).toHaveURL(/\/countries\/JP$/);
  await expect(page.getByRole('link', { name: /東京，雨停之後/ })).toBeVisible();
  await verifyRouteLayout(page);

  diagnostics.setStage('journey route');
  await page.getByRole('link', { name: /東京，雨停之後/ }).click();
  await expect(page.getByRole('link', { name: /播放這趟旅程/ })).toBeVisible();
  await expectLoadedFixtureImages(page);
  await verifyRouteLayout(page);

  diagnostics.setStage('player route');
  await page.getByRole('link', { name: /播放這趟旅程/ }).click();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '雨夜裡的澀谷十字路口' })).toBeVisible();
  await expectLoadedFixtureImages(page);

  const player = page.getByTitle('YouTube player');
  await expect(player).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(player).toHaveAttribute('src', /autoplay=0/);
  await expect(player).not.toHaveAttribute('allow', /autoplay/);
  await verifyRouteLayout(page);
  await page.screenshot({ path: testInfo.outputPath('atlas-player.png'), fullPage: true });

  await page.getByRole('button', { name: '下一個時刻' }).click();
  await expect(page.getByText('2 / 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一個時刻' }).click();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();

  diagnostics.setStage('atlas remount before screenshot');
  await page.goBack();
  await expect(page.getByRole('link', { name: /播放這趟旅程/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: /東京，雨停之後/ })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('旅行世界地圖')).toBeVisible();
  await expectMapScreenshotVariance(page, testInfo.outputPath('atlas-map-remount.png'), testInfo.project.name, 'remount');
  await expectEastAsiaMarkerPlacement(page);
  await verifyRouteLayout(page);
  diagnostics.setStage('atlas remount after screenshot');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  expect(diagnostics.errors).toEqual([]);
});

test('keeps East Asia markers inside the map after a mobile orientation change', async ({ page }, testInfo: TestInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This scenario runs only in the mobile project.');
  test.setTimeout(90_000);
  const diagnostics = collectPageErrors(page);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  const map = page.locator('.world-map');
  await expect(map).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });

  for (const width of [390, 375]) {
    diagnostics.setStage(`portrait orientation resize at ${width}px`);
    await page.setViewportSize({ width, height: 844 });
    await expect(map).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
    await expectNonBlankMapCanvas(page);
    await expectEastAsiaMarkerPlacement(page);
    await verifyRouteLayout(page);
  }
  expect(diagnostics.errors).toEqual([]);
});

test('has no horizontal overflow on every route', async ({ page }) => {
  test.setTimeout(90_000);
  const diagnostics = collectPageErrors(page);
  for (const route of ['/', '/countries/JP', '/journeys/tokyo-2024', '/journeys/tokyo-2024/play']) {
    diagnostics.setStage(`direct route ${route}`);
    await page.goto(route);
    await expect(page.locator('.page')).toBeVisible();
    if (route === '/') {
      await expect(page.getByLabel('旅行世界地圖')).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
    }
    if (route === '/countries/JP') {
      await expect(page.getByRole('link', { name: /東京，雨停之後/ })).toBeVisible();
    }
    if (route === '/journeys/tokyo-2024') {
      await expect(page.getByRole('link', { name: /播放這趟旅程/ })).toBeVisible();
      await expectLoadedFixtureImages(page);
    }
    if (route === '/journeys/tokyo-2024/play') {
      await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
      await expectLoadedFixtureImages(page);
    }
    await verifyRouteLayout(page);
    expect(diagnostics.errors).toEqual([]);
  }
});
