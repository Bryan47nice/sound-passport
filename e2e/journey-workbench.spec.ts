import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { DB_VERSION } from '../src/data/indexedDb';
import { verifyRouteLayout } from './helpers/layoutAssertions';
import { makePng } from './helpers/testImages';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const journeyFixture = {
  createSummary: '建立階段使用的非私人合成摘要。',
  createTitle: '台灣合成旅程草稿',
  cities: ['台北', '花蓮'],
  countryCode: 'TW',
  countryName: '台灣',
  endDate: '2026-04-05',
  startDate: '2026-04-01',
  summary: '從城市晨光到海邊晚風，這是一段只供自動化驗收使用的合成旅程總文。',
  title: '台灣聲景驗收旅程',
};

const momentFixtures = [
  {
    artist: '合成晨光樂團',
    caption: '晨光穿過騎樓，這是第一則非私人合成時刻文案。',
    city: '台北',
    fileName: 'synthetic-portrait.png',
    height: 1600,
    localDate: '2026-04-02',
    localTime: '09:15',
    place: '大稻埕',
    reason: '節奏與晨間步行一致，僅供端對端驗收。',
    rgb: [214, 82, 68] as const,
    songTitle: '合成晨光測試曲',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    width: 900,
  },
  {
    artist: '合成海岸演奏者',
    caption: '晚風沿著海岸移動，這是第二則非私人合成時刻文案。',
    city: '花蓮',
    fileName: 'synthetic-landscape.png',
    height: 900,
    localDate: '2026-04-04',
    localTime: '18:30',
    place: '七星潭',
    reason: '旋律呼應海面光線，內容完全由測試產生。',
    rgb: [32, 104, 92] as const,
    songTitle: '合成海風測試曲',
    sourceUrl: '',
    width: 1600,
  },
];

type MomentFixture = (typeof momentFixtures)[number];
const mobileJourneyId = 'synthetic-mobile-taiwan-journey';

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  let stage = 'setup';

  page.on('pageerror', (error) => errors.push(`[${stage}] pageerror: ${error.stack || error.message}`));
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

async function expectImageDimensions(image: Locator, width: number, height: number) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    height: element.naturalHeight,
    objectFit: getComputedStyle(element).objectFit,
    width: element.naturalWidth,
  }))).toEqual({ complete: true, height, objectFit: 'contain', width });
}

async function expectLoadedImages(images: Locator, count: number) {
  await expect(images).toHaveCount(count);
  await expect.poll(() => images.evaluateAll((elements: HTMLImageElement[]) => (
    elements.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0)
  ))).toBe(true);
}

async function readPersistedJourney(page: Page, journeyId: string) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sound-passport');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['journeys', 'moments'], 'readonly');
      const completion = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const journey = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = transaction.objectStore('journeys').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const moments = await new Promise<Array<{ id: string; journeyId: string; sortOrder: number }>>((resolve, reject) => {
        const request = transaction.objectStore('moments').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await completion;
      if (!journey) return null;
      return {
        order: moments
          .filter((moment) => moment.journeyId === id)
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((moment) => moment.id),
        status: journey.status,
        updatedAt: journey.updatedAt,
      };
    } finally {
      database.close();
    }
  }, journeyId);
}

async function readCanonicalPrivateSnapshot(page: Page) {
  return page.evaluate(async () => {
    type StoredRecord = { id: string } & Record<string, unknown>;
    type StoredPhoto = StoredRecord & { blob: Blob };
    const storeNames = ['journeys', 'moments', 'songs', 'photos'] as const;
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sound-passport');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stableByPrimaryKey = <T extends StoredRecord>(records: T[]) => (
      [...records].sort((left, right) => left.id.localeCompare(right.id))
    );

    try {
      const transaction = database.transaction(storeNames, 'readonly');
      const completion = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      const [journeys, moments, songs, photos] = await Promise.all([
        requestResult(transaction.objectStore('journeys').getAll()) as Promise<StoredRecord[]>,
        requestResult(transaction.objectStore('moments').getAll()) as Promise<StoredRecord[]>,
        requestResult(transaction.objectStore('songs').getAll()) as Promise<StoredRecord[]>,
        requestResult(transaction.objectStore('photos').getAll()) as Promise<StoredPhoto[]>,
      ]);
      await completion;

      const canonicalPhotos = await Promise.all(stableByPrimaryKey(photos).map(async ({ blob, ...metadata }) => {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return {
          ...metadata,
          blob: {
            sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
            size: blob.size,
            type: blob.type,
          },
        };
      }));

      return {
        counts: {
          journeys: journeys.length,
          moments: moments.length,
          photos: photos.length,
          songs: songs.length,
        },
        journeys: stableByPrimaryKey(journeys),
        moments: stableByPrimaryKey(moments),
        photos: canonicalPhotos,
        songs: stableByPrimaryKey(songs),
      };
    } finally {
      database.close();
    }
  });
}

async function downloadBuffer(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function corruptFirstPhoto(archive: Buffer) {
  const files = unzipSync(new Uint8Array(archive));
  const photoPath = Object.keys(files).sort().find((path) => path.startsWith('photos/'));
  if (!photoPath) throw new Error('Expected the backup to contain a photo');
  const photo = files[photoPath];
  if (photo.length === 0) throw new Error('Expected a non-empty backup photo');
  const corrupted = photo.slice();
  corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
  files[photoPath] = corrupted;
  const storedFiles: Zippable = {};
  for (const [path, bytes] of Object.entries(files)) storedFiles[path] = [bytes, { level: 0 }];
  return Buffer.from(zipSync(storedFiles));
}

async function fillMoment(page: Page, fixture: MomentFixture) {
  const region = page.getByRole('region', { name: '時刻資料' });
  await region.getByLabel('日期').fill(fixture.localDate);
  await region.getByLabel('時間').fill(fixture.localTime);
  await region.getByLabel('城市').fill(fixture.city);
  await region.getByLabel('地點').fill(fixture.place);
  await region.getByLabel('時刻文案').fill(fixture.caption);
  await region.getByLabel('歌名').fill(fixture.songTitle);
  await region.getByLabel('歌手').fill(fixture.artist);
  await region.getByLabel('YouTube 連結').fill(fixture.sourceUrl);
  await region.getByLabel('選歌原因').fill(fixture.reason);
  await expect(region.locator('.moment-save-status')).toContainText('時刻已儲存', { timeout: 15_000 });
}

async function expectEditorState(
  page: Page,
  expectedMoments: readonly MomentFixture[],
  expectedStatus: '草稿' | '待整理' | '已完成',
) {
  await expect(page.getByRole('heading', { level: 1, name: journeyFixture.title })).toBeVisible();
  await expect(page.locator('.journey-status')).toHaveText(expectedStatus);

  const journeyRegion = page.getByRole('region', { name: '旅程資料' });
  await expect(journeyRegion.getByLabel('旅程標題')).toHaveValue(journeyFixture.title);
  await expect(journeyRegion.getByLabel('國家')).toHaveValue(journeyFixture.countryCode);
  await expect(journeyRegion.getByLabel('開始日期')).toHaveValue(journeyFixture.startDate);
  await expect(journeyRegion.getByLabel('結束日期')).toHaveValue(journeyFixture.endDate);
  await expect(journeyRegion.getByLabel('旅程總文（選填）')).toHaveValue(journeyFixture.summary);
  for (const city of journeyFixture.cities) {
    await expect(journeyRegion.getByRole('listitem', { name: city })).toBeVisible();
  }

  const rows = page.getByRole('region', { name: '時刻清單' }).getByRole('listitem');
  await expect(rows).toHaveCount(expectedMoments.length);
  for (let index = 0; index < expectedMoments.length; index += 1) {
    const fixture = expectedMoments[index];
    await expect(rows.nth(index)).toContainText(fixture.songTitle);
    await rows.nth(index).getByRole('button', { name: /^選取第/ }).click();

    const region = page.getByRole('region', { name: '時刻資料' });
    await expect(region.getByText(`第 ${index + 1} 則`, { exact: true })).toBeVisible();
    await expect(region.getByLabel('日期')).toHaveValue(fixture.localDate);
    await expect(region.getByLabel('時間')).toHaveValue(fixture.localTime);
    await expect(region.getByLabel('城市')).toHaveValue(fixture.city);
    await expect(region.getByLabel('地點')).toHaveValue(fixture.place);
    await expect(region.getByLabel('時刻文案')).toHaveValue(fixture.caption);
    await expect(region.getByLabel('歌名')).toHaveValue(fixture.songTitle);
    await expect(region.getByLabel('歌手')).toHaveValue(fixture.artist);
    await expect(region.getByLabel('YouTube 連結')).toHaveValue(fixture.sourceUrl);
    await expect(region.getByLabel('選歌原因')).toHaveValue(fixture.reason);
    await expectImageDimensions(page.locator('.journey-editor-preview-image'), fixture.width, fixture.height);
  }
  await verifyRouteLayout(page);
}

async function seedCompletedMobileJourney(page: Page, portrait: Buffer, landscape: Buffer) {
  const createdAt = '2026-04-06T08:00:00.000Z';
  await page.evaluate(async (payload) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sound-passport');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const decode = (base64: string) => Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    try {
      const portraitBytes = decode(payload.portrait.base64);
      const landscapeBytes = decode(payload.landscape.base64);
      const transaction = database.transaction(['journeys', 'moments', 'songs', 'photos'], 'readwrite');
      const completion = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });

      transaction.objectStore('journeys').put(payload.journey);
      for (const song of payload.songs) transaction.objectStore('songs').put(song);
      for (const moment of payload.moments) transaction.objectStore('moments').put(moment);
      transaction.objectStore('photos').put({
        ...payload.portrait.metadata,
        blob: new Blob([portraitBytes], { type: 'image/png' }),
      });
      transaction.objectStore('photos').put({
        ...payload.landscape.metadata,
        blob: new Blob([landscapeBytes], { type: 'image/png' }),
      });
      await completion;
    } finally {
      database.close();
    }
  }, {
    journey: {
      cityLabels: [...journeyFixture.cities],
      countryCode: journeyFixture.countryCode,
      countryCoordinates: [120.9605, 23.6978],
      countryName: journeyFixture.countryName,
      coverPhotoAssetId: 'synthetic-mobile-photo-portrait',
      createdAt,
      endDate: journeyFixture.endDate,
      id: mobileJourneyId,
      source: 'private',
      startDate: journeyFixture.startDate,
      status: 'complete',
      summary: '這是一趟僅供 390x844 回放驗收使用的合成私人旅程。',
      title: '台灣行動回放驗收旅程',
      updatedAt: createdAt,
    },
    landscape: {
      base64: landscape.toString('base64'),
      metadata: {
        byteSize: landscape.byteLength,
        contentType: 'image/png',
        createdAt,
        height: 900,
        id: 'synthetic-mobile-photo-landscape',
        originalFileName: 'synthetic-mobile-landscape.png',
        width: 1600,
      },
    },
    moments: [
      {
        caption: '合成直式時刻文案',
        cityLabel: '台北',
        createdAt,
        id: 'synthetic-mobile-moment-portrait',
        journeyId: mobileJourneyId,
        localDate: '2026-04-02',
        localTime: '09:15',
        photoAlt: '合成直式測試影像',
        photoAssetId: 'synthetic-mobile-photo-portrait',
        placeLabel: '大稻埕',
        reason: '合成直式時刻的測試選歌原因。',
        reasonStatus: 'complete',
        songReferenceId: 'synthetic-mobile-song-portrait',
        sortOrder: 0,
        updatedAt: createdAt,
      },
      {
        caption: '合成橫式時刻文案',
        cityLabel: '花蓮',
        createdAt,
        id: 'synthetic-mobile-moment-landscape',
        journeyId: mobileJourneyId,
        localDate: '2026-04-04',
        localTime: '18:30',
        photoAlt: '合成橫式測試影像',
        photoAssetId: 'synthetic-mobile-photo-landscape',
        placeLabel: '七星潭',
        reason: '合成橫式時刻的測試選歌原因。',
        reasonStatus: 'complete',
        songReferenceId: 'synthetic-mobile-song-landscape',
        sortOrder: 1,
        updatedAt: createdAt,
      },
    ],
    portrait: {
      base64: portrait.toString('base64'),
      metadata: {
        byteSize: portrait.byteLength,
        contentType: 'image/png',
        createdAt,
        height: 1600,
        id: 'synthetic-mobile-photo-portrait',
        originalFileName: 'synthetic-mobile-portrait.png',
        width: 900,
      },
    },
    songs: [
      {
        artist: '合成行動樂團',
        availability: 'available',
        id: 'synthetic-mobile-song-portrait',
        provider: 'youtube',
        providerItemId: 'dQw4w9WgXcQ',
        sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: '合成行動晨光曲',
      },
      {
        artist: '合成行動演奏者',
        availability: 'needs_link',
        id: 'synthetic-mobile-song-landscape',
        provider: 'manual',
        title: '合成行動海風曲',
      },
    ],
  });
}

async function expectMobileStudioGuidance(page: Page, route: string) {
  await page.goto(route);
  await expect(page.getByRole('heading', { level: 1, name: '請使用電腦整理旅程' })).toBeVisible();
  await expect(page.locator('main input, main textarea, main select, main button')).toHaveCount(0);
  await expect(page.locator('.studio-toolbar, .studio-tabs, .journey-create-form, .journey-editor-page')).toHaveCount(0);
  await verifyRouteLayout(page);
}

test('makePng creates decodable PNG fixtures with the requested dimensions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixture contract only needs one browser proof.');

  for (const fixture of [
    { width: 900, height: 1600, rgb: [214, 82, 68] as const },
    { width: 1600, height: 900, rgb: [32, 104, 92] as const },
  ]) {
    const png = makePng(fixture.width, fixture.height, fixture.rgb);

    expect(png.subarray(0, pngSignature.length)).toEqual(pngSignature);
    expect(png.readUInt32BE(16)).toBe(fixture.width);
    expect(png.readUInt32BE(20)).toBe(fixture.height);

    await page.setContent(`<img alt="fixture" src="data:image/png;base64,${png.toString('base64')}">`);
    await expect.poll(() => page.getByRole('img', { name: 'fixture' }).evaluate((image: HTMLImageElement) => ({
      complete: image.complete,
      height: image.naturalHeight,
      width: image.naturalWidth,
    }))).toEqual({ complete: true, height: fixture.height, width: fixture.width });
  }
});

test('completes, backs up, clears, restores, and protects a private desktop journey', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'This end-to-end authoring flow runs on desktop.');
  test.setTimeout(240_000);
  const diagnostics = collectPageErrors(page);
  const portrait = makePng(
    momentFixtures[0].width,
    momentFixtures[0].height,
    momentFixtures[0].rgb,
  );
  const landscape = makePng(
    momentFixtures[1].width,
    momentFixtures[1].height,
    momentFixtures[1].rgb,
  );

  diagnostics.setStage('studio dashboard');
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1, name: '整理旅程' })).toBeVisible();
  await verifyRouteLayout(page);

  diagnostics.setStage('create journey');
  await page.getByRole('link', { name: '新增旅程' }).click();
  await expect(page).toHaveURL(/\/studio\/journeys\/new$/);
  await page.getByLabel('旅程標題').fill(journeyFixture.createTitle);
  await page.getByLabel('國家').fill(journeyFixture.countryName);
  await page.getByLabel('開始日期').fill(journeyFixture.startDate);
  await page.getByLabel('結束日期').fill(journeyFixture.endDate);
  for (const city of journeyFixture.cities) {
    await page.getByRole('textbox', { name: '城市', exact: true }).fill(city);
    await page.getByRole('button', { name: '新增城市' }).click();
  }
  await page.getByLabel('旅程總文（選填）').fill(journeyFixture.createSummary);
  await verifyRouteLayout(page);
  await page.getByRole('button', { name: '建立旅程' }).click();
  await expect(page).toHaveURL(/\/studio\/journeys\/[^/]+$/);
  const journeyId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('heading', { level: 1, name: journeyFixture.createTitle })).toBeVisible();

  diagnostics.setStage('journey autosave and photo upload');
  const journeyRegion = page.getByRole('region', { name: '旅程資料' });
  await journeyRegion.getByLabel('旅程標題').fill(journeyFixture.title);
  await journeyRegion.getByLabel('旅程總文（選填）').fill(journeyFixture.summary);
  await expect(page.locator('.journey-save-status')).toContainText('已儲存', { timeout: 15_000 });
  await page.locator('input[type="file"][aria-label="加入照片"]').setInputFiles([
    { buffer: portrait, mimeType: 'image/png', name: momentFixtures[0].fileName },
    { buffer: landscape, mimeType: 'image/png', name: momentFixtures[1].fileName },
  ]);
  const rows = page.getByRole('region', { name: '時刻清單' }).getByRole('listitem');
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator('.photo-upload-failures')).toHaveCount(0);
  await expectImageDimensions(
    page.locator('.journey-editor-preview-image'),
    momentFixtures[0].width,
    momentFixtures[0].height,
  );

  diagnostics.setStage('first moment autosave');
  await fillMoment(page, momentFixtures[0]);
  await rows.nth(1).getByRole('button', { name: /^選取第/ }).click();
  await expectImageDimensions(
    page.locator('.journey-editor-preview-image'),
    momentFixtures[1].width,
    momentFixtures[1].height,
  );

  diagnostics.setStage('second moment autosave');
  await fillMoment(page, momentFixtures[1]);

  diagnostics.setStage('reload persisted fields and photos');
  await page.reload();
  await expectEditorState(page, momentFixtures, '草稿');

  diagnostics.setStage('reorder and reload');
  const originalIds = await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-id')!));
  await page.getByRole('button', { name: '將第二則上移' }).click();
  await expect(rows.nth(0)).toContainText(momentFixtures[1].songTitle);
  await expect.poll(async () => (await readPersistedJourney(page, journeyId))?.order).toEqual([
    originalIds[1],
    originalIds[0],
  ]);
  await page.reload();
  const reorderedMoments = [momentFixtures[1], momentFixtures[0]] as const;
  await expectEditorState(page, reorderedMoments, '草稿');

  diagnostics.setStage('draft preview without status mutation or autoplay');
  const draftSnapshotBeforePreview = await readCanonicalPrivateSnapshot(page);
  await page.goto(`/studio/journeys/${journeyId}/preview`);
  await expect(page.getByRole('heading', { level: 1, name: journeyFixture.title })).toBeVisible();
  await expect(page.getByRole('button', { name: '完成旅程' })).toHaveCount(0);
  expect(await readCanonicalPrivateSnapshot(page)).toEqual(draftSnapshotBeforePreview);
  const draftPreviewFrame = page.getByTitle('YouTube player');
  await expect(draftPreviewFrame).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(draftPreviewFrame).toHaveAttribute('src', /autoplay=0/);
  await expect(draftPreviewFrame).not.toHaveAttribute('allow', /autoplay/);
  await verifyRouteLayout(page);
  await page.getByRole('link', { name: '返回編輯' }).click();
  await expect(page.locator('.journey-status')).toHaveText('草稿');

  diagnostics.setStage('review preview without autoplay');
  await page.getByRole('button', { name: '前往預覽' }).click();
  await expect(page).toHaveURL(new RegExp(`/studio/journeys/${journeyId}/preview$`));
  await expect(page.getByRole('button', { name: '完成旅程' })).toBeVisible();
  await expect.poll(async () => (await readPersistedJourney(page, journeyId))?.status).toBe('review');
  const reviewSnapshotBeforePreview = await readCanonicalPrivateSnapshot(page);
  const previewFrame = page.getByTitle('YouTube player');
  await expect(previewFrame).toHaveCount(1);
  await expect(previewFrame).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(previewFrame).toHaveAttribute('src', /autoplay=0/);
  await expect(previewFrame).not.toHaveAttribute('allow', /autoplay/);
  await expect(page.locator('.journey-preview-moment').nth(0)).toContainText(momentFixtures[1].caption);
  await expect(page.locator('.journey-preview-moment').nth(1)).toContainText(momentFixtures[0].caption);
  await verifyRouteLayout(page);
  await page.reload();
  await expect(page.getByRole('button', { name: '完成旅程' })).toBeVisible();
  expect(await readCanonicalPrivateSnapshot(page)).toEqual(reviewSnapshotBeforePreview);

  diagnostics.setStage('explicit completion');
  await page.getByRole('button', { name: '完成旅程' }).click();
  const completionDialog = page.getByRole('dialog', { name: '完成旅程' });
  await expect(completionDialog).toBeVisible();
  await completionDialog.getByRole('button', { name: '確認完成旅程' }).click();
  await expect(page).toHaveURL(new RegExp(`/journeys/${journeyId}$`));
  await expect.poll(async () => (await readPersistedJourney(page, journeyId))?.status).toBe('complete');

  diagnostics.setStage('atlas to country to journey');
  await page.getByRole('link', { name: '世界地圖' }).click();
  await expect(page.getByLabel('旅行世界地圖')).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  const taiwanMarker = page.getByRole('button', { name: '台灣，1 趟旅程' });
  await expect(taiwanMarker).toBeVisible();
  await verifyRouteLayout(page);
  await taiwanMarker.click();
  await expect(page).toHaveURL(/\/countries\/TW$/);
  await expect(page.getByRole('heading', { level: 1, name: journeyFixture.countryName })).toBeVisible();
  await verifyRouteLayout(page);
  await page.getByRole('link', { name: new RegExp(journeyFixture.title) }).click();
  await expect(page).toHaveURL(new RegExp(`/journeys/${journeyId}$`));
  await expectLoadedImages(page.locator('.moment-row img'), 2);
  const journeyRows = page.locator('.moment-row');
  await expect(journeyRows.nth(0)).toContainText(momentFixtures[1].caption);
  await expect(journeyRows.nth(1)).toContainText(momentFixtures[0].caption);
  await verifyRouteLayout(page);

  diagnostics.setStage('journey player order and media policy');
  await page.getByRole('link', { name: '播放這趟旅程' }).click();
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(page.locator('.player-copy h1')).toHaveText(momentFixtures[1].songTitle);
  await expectImageDimensions(page.locator('.player-photo'), momentFixtures[1].width, momentFixtures[1].height);
  await expect(page.getByTitle('YouTube player')).toHaveCount(0);
  await verifyRouteLayout(page);
  await page.getByRole('button', { name: '下一個時刻' }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(page.locator('.player-copy h1')).toHaveText(momentFixtures[0].songTitle);
  await expectImageDimensions(page.locator('.player-photo'), momentFixtures[0].width, momentFixtures[0].height);
  const playerFrame = page.getByTitle('YouTube player');
  await expect(playerFrame).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(playerFrame).toHaveAttribute('src', /autoplay=0/);
  await expect(playerFrame).not.toHaveAttribute('allow', /autoplay/);
  await verifyRouteLayout(page);

  diagnostics.setStage('real backup export');
  await page.getByRole('link', { name: '整理' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '整理旅程' })).toBeVisible();
  await verifyRouteLayout(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出私人備份' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.soundpassport$/);
  const backup = await downloadBuffer(download);
  const backupFiles = unzipSync(new Uint8Array(backup));
  expect(Object.keys(backupFiles).filter((path) => path.startsWith('photos/'))).toHaveLength(2);
  const snapshotBeforeClear = await readCanonicalPrivateSnapshot(page);
  expect(snapshotBeforeClear.counts).toEqual({ journeys: 1, moments: 2, photos: 2, songs: 2 });

  diagnostics.setStage('clear private data');
  await page.getByRole('button', { name: '清除私人資料' }).click();
  const clearDialog = page.getByRole('dialog', { name: '清除私人資料' });
  await clearDialog.getByLabel('輸入確認文字').fill('清除我的私人旅程');
  await clearDialog.getByRole('button', { name: '永久清除私人資料' }).click();
  await expect(clearDialog).toHaveCount(0);
  expect(await readCanonicalPrivateSnapshot(page)).toEqual({
    counts: { journeys: 0, moments: 0, photos: 0, songs: 0 },
    journeys: [],
    moments: [],
    photos: [],
    songs: [],
  });
  await page.getByRole('link', { name: '世界地圖' }).click();
  await expect(page.getByLabel('旅行世界地圖')).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  await expect(page.getByRole('button', { name: '台灣，1 趟旅程' })).toHaveCount(0);
  await expect(page.getByText(journeyFixture.title)).toHaveCount(0);
  await verifyRouteLayout(page);

  diagnostics.setStage('real backup import and complete restore');
  await page.getByRole('link', { name: '整理' }).click();
  const validFileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '匯入私人備份' }).click();
  const validFileChooser = await validFileChooserPromise;
  await validFileChooser.setFiles({
    buffer: backup,
    mimeType: 'application/vnd.sound-passport.backup',
    name: 'synthetic-journey.soundpassport',
  });
  const importDialog = page.getByRole('dialog', { name: '匯入私人備份' });
  await expect(importDialog.getByText('1 趟旅程', { exact: true })).toBeVisible();
  await expect(importDialog.getByText('2 個時刻', { exact: true })).toBeVisible();
  await expect(importDialog.getByText('2 張照片', { exact: true })).toBeVisible();
  await importDialog.getByRole('button', { name: '確認匯入' }).click();
  await expect(importDialog.getByText('匯入完成', { exact: true })).toBeVisible();
  await importDialog.getByRole('button', { name: '完成' }).click();
  await expect(importDialog).toHaveCount(0);
  const snapshotAfterRestore = await readCanonicalPrivateSnapshot(page);
  expect(snapshotAfterRestore.counts).toEqual(snapshotBeforeClear.counts);
  expect(snapshotAfterRestore).toEqual(snapshotBeforeClear);
  await page.getByRole('tab', { name: '已完成' }).click();
  await expect(page.getByRole('link', { name: journeyFixture.title })).toHaveCount(1);
  await page.getByRole('link', { name: journeyFixture.title }).click();
  await expectEditorState(page, reorderedMoments, '已完成');

  diagnostics.setStage('post-restore atlas to country to complete playback');
  await page.getByRole('link', { name: '世界地圖' }).click();
  await expect(page.getByLabel('旅行世界地圖')).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  const restoredTaiwanMarker = page.getByRole('button', { name: '台灣，1 趟旅程' });
  await expect(restoredTaiwanMarker).toBeVisible();
  await verifyRouteLayout(page);
  await restoredTaiwanMarker.click();
  await expect(page).toHaveURL(/\/countries\/TW$/);
  await expect(page.getByRole('heading', { level: 1, name: journeyFixture.countryName })).toBeVisible();
  await verifyRouteLayout(page);
  await page.getByRole('link', { name: new RegExp(journeyFixture.title) }).click();
  await expect(page).toHaveURL(new RegExp(`/journeys/${journeyId}$`));
  await expectLoadedImages(page.locator('.moment-row img'), 2);
  const restoredJourneyRows = page.locator('.moment-row');
  await expect(restoredJourneyRows.nth(0)).toContainText(momentFixtures[1].caption);
  await expect(restoredJourneyRows.nth(1)).toContainText(momentFixtures[0].caption);
  await verifyRouteLayout(page);
  await page.getByRole('link', { name: '播放這趟旅程' }).click();
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await expect(page.locator('.player-copy h1')).toHaveText(momentFixtures[1].songTitle);
  await expectImageDimensions(page.locator('.player-photo'), momentFixtures[1].width, momentFixtures[1].height);
  await expect(page.getByTitle('YouTube player')).toHaveCount(0);
  await verifyRouteLayout(page);
  await page.getByRole('button', { name: '下一個時刻' }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(page.locator('.player-copy h1')).toHaveText(momentFixtures[0].songTitle);
  await expectImageDimensions(page.locator('.player-photo'), momentFixtures[0].width, momentFixtures[0].height);
  const restoredPlayerFrame = page.getByTitle('YouTube player');
  await expect(restoredPlayerFrame).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(restoredPlayerFrame).toHaveAttribute('src', /autoplay=0/);
  await expect(restoredPlayerFrame).not.toHaveAttribute('allow', /autoplay/);
  await verifyRouteLayout(page);

  diagnostics.setStage('corrupted photo import rejection');
  const corruptedBackup = corruptFirstPhoto(backup);
  await page.getByRole('link', { name: '整理' }).click();
  const snapshotBeforeDamagedImport = await readCanonicalPrivateSnapshot(page);
  const damagedFileChooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '匯入私人備份' }).click();
  const damagedFileChooser = await damagedFileChooserPromise;
  await damagedFileChooser.setFiles({
    buffer: corruptedBackup,
    mimeType: 'application/vnd.sound-passport.backup',
    name: 'synthetic-journey-corrupted.soundpassport',
  });
  const invalidDialog = page.getByRole('dialog', { name: '匯入私人備份' });
  await expect(invalidDialog.getByRole('alert')).toHaveText('備份照片驗證失敗，無法匯入。');
  await invalidDialog.getByRole('button', { name: '關閉' }).click();
  await expect(invalidDialog).toHaveCount(0);
  expect(await readCanonicalPrivateSnapshot(page)).toEqual(snapshotBeforeDamagedImport);
  await page.getByRole('tab', { name: '已完成' }).click();
  await expect(page.getByRole('link', { name: journeyFixture.title })).toHaveCount(1);
  await page.getByRole('link', { name: journeyFixture.title }).click();
  await expectEditorState(page, reorderedMoments, '已完成');

  expect(diagnostics.errors, diagnostics.errors.join('\n')).toEqual([]);
});

test('plays a preloaded private journey without mobile editing, overflow, overlap, or autoplay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This responsive proof runs at the mobile project viewport.');
  test.setTimeout(120_000);
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
  const diagnostics = collectPageErrors(page);
  const portrait = makePng(900, 1600, [214, 82, 68]);
  const landscape = makePng(1600, 900, [32, 104, 92]);

  diagnostics.setStage('initialize private IndexedDB');
  await page.goto('/studio');
  await expect.poll(() => page.evaluate(async (expectedVersion) => (
    (await indexedDB.databases()).some((database) => database.name === 'sound-passport' && database.version === expectedVersion)
  ), DB_VERSION)).toBe(true);
  await seedCompletedMobileJourney(page, portrait, landscape);

  diagnostics.setStage('mobile Studio guidance routes');
  for (const route of [
    '/studio',
    '/studio/journeys/new',
    `/studio/journeys/${mobileJourneyId}`,
    `/studio/journeys/${mobileJourneyId}/preview`,
  ]) {
    await expectMobileStudioGuidance(page, route);
  }
  await page.goto('/studio');
  await expect(page.getByText('旅程回顧仍可在此裝置查看。')).toBeVisible();

  diagnostics.setStage('mobile Atlas');
  await page.getByRole('link', { name: '世界地圖' }).click();
  await expect(page.getByLabel('旅行世界地圖')).toHaveAttribute('data-map-ready', 'true', { timeout: 45_000 });
  const taiwanMarker = page.getByRole('button', { name: '台灣，1 趟旅程' });
  await expect(taiwanMarker).toBeVisible();
  await verifyRouteLayout(page);

  diagnostics.setStage('mobile country');
  await taiwanMarker.click();
  await expect(page).toHaveURL(/\/countries\/TW$/);
  const journeyLink = page.getByRole('link', { name: /台灣行動回放驗收旅程/ });
  await expect(journeyLink).toBeVisible();
  await verifyRouteLayout(page);

  diagnostics.setStage('mobile journey');
  await journeyLink.click();
  await expect(page).toHaveURL(new RegExp(`/journeys/${mobileJourneyId}$`));
  const journeyImages = page.locator('.moment-row img');
  await expectLoadedImages(journeyImages, 2);
  await expectImageDimensions(journeyImages.nth(0), 900, 1600);
  await expectImageDimensions(journeyImages.nth(1), 1600, 900);
  await expect(page.locator('.moment-row').nth(0)).toContainText('合成直式時刻文案');
  await expect(page.locator('.moment-row').nth(1)).toContainText('合成橫式時刻文案');
  await verifyRouteLayout(page);

  diagnostics.setStage('mobile portrait player and YouTube policy');
  await page.getByRole('link', { name: '播放這趟旅程' }).click();
  await expect(page.getByText('1 / 2', { exact: true })).toBeVisible();
  await expectImageDimensions(page.locator('.player-photo'), 900, 1600);
  const playerFrame = page.getByTitle('YouTube player');
  await expect(playerFrame).toHaveAttribute('src', /youtube-nocookie\.com/);
  await expect(playerFrame).toHaveAttribute('src', /autoplay=0/);
  await expect(playerFrame).not.toHaveAttribute('allow', /autoplay/);
  await verifyRouteLayout(page);

  diagnostics.setStage('mobile landscape player');
  await page.getByRole('button', { name: '下一個時刻' }).click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await expectImageDimensions(page.locator('.player-photo'), 1600, 900);
  await expect(page.getByTitle('YouTube player')).toHaveCount(0);
  await verifyRouteLayout(page);

  expect(diagnostics.errors, diagnostics.errors.join('\n')).toEqual([]);
});
