# Sound Passport 過往旅程整理工作台設計規格

**日期：** 2026-07-13
**狀態：** 待使用者書面審閱
**版本：** 0.1

## 1. 目標

第二階段要讓 Sound Passport 從唯讀示範，變成能在電腦上實際整理私人旅遊回憶的產品。使用者會一邊在手機查看 Instagram 限時動態典藏，一邊在電腦建立過往旅程、加入照片或限動截圖、補上歌曲與文案，最後透過既有 Atlas 與播放器回顧。

本階段以「桌機整理、本機私密保存」為核心。手機只需要維持良好的回放版面，不提供完整編輯，也不做跨裝置同步。

## 2. 使用情境

主要使用者已有多趟旅行保存在 Instagram 限時動態典藏中。大部分限時動態可以看見歌名與歌手，但尚未建立 YouTube 播放清單。整理時可能使用無貼圖的原始照片，也可能使用保留文字與版面的直式限動截圖。

一次完整使用流程如下：

1. 使用者在電腦開啟 Sound Passport 整理工作台。
2. 在手機查看一趟過往旅行的 Instagram 典藏。
3. 建立旅程並填寫國家、城市、日期、標題與旅程總文。
4. 批次選取原始照片或限動截圖。
5. 逐則補上日期、地點、時刻文案、歌名、歌手與選歌原因。
6. 已找到 YouTube 影片時貼上連結；尚未找到時先保留待補狀態。
7. 調整音樂時刻順序並預覽。
8. 將旅程標記為完成，使其出現在 Atlas 與既有播放器。

## 3. 範圍

### 3.1 本階段包含

- 建立、編輯與刪除私人旅程。
- 建立、編輯、刪除與排序音樂時刻。
- 批次加入 JPEG、PNG、WebP 與瀏覽器可解碼的圖片。
- 混合使用直式限動截圖與橫式或直式原始照片。
- 旅程總文、時刻文案與選歌原因分開保存。
- 手動輸入歌名、歌手及選填 YouTube 連結。
- 草稿、待整理與完成狀態。
- 自動儲存與明確的儲存狀態。
- IndexedDB 本機持久化。
- 單一 `.soundpassport` 檔案的完整備份與還原。
- 已完成私人旅程接入 Atlas、國家頁、旅程頁與播放器。
- 桌機整理與手機尺寸回放驗證。

### 3.2 本階段不包含

- Firebase、登入、雲端儲存或跨裝置同步。
- 手機完整編輯器。
- Instagram 登入、自動匯入或典藏解析。
- OCR、歌曲辨識或音訊辨識。
- YouTube Data API 搜尋、OAuth 或播放清單匯出。
- 公開分享。
- HEIC／HEIF 轉檔。
- 相機原始檔或原始解析度封存。

## 4. 資訊架構與路由

既有 Atlas 保持產品首頁，導覽新增「整理」入口。

| 路由 | 用途 |
| --- | --- |
| `/` | Atlas，只顯示示範旅程與已完成私人旅程 |
| `/studio` | 私人旅程工作台 |
| `/studio/journeys/new` | 建立旅程 |
| `/studio/journeys/:journeyId` | 旅程編輯器 |
| `/studio/journeys/:journeyId/preview` | 草稿或完成旅程預覽 |
| `/countries/:countryCode` | 國家旅程清單 |
| `/journeys/:journeyId` | 已完成旅程詳情 |
| `/journeys/:journeyId/play` | 已完成旅程播放器 |

示範旅程維持唯讀並標示「示範」，不出現在 `/studio`，也不能被私人資料操作刪除。私人草稿不會出現在 Atlas 或公開的旅程查詢路由。

## 5. 頁面設計

### 5.1 整理工作台

工作台是密度適中的桌機工具，不使用行銷式首頁或多層卡片。主要區域包含：

- 頂部工具列：新增旅程、匯出備份、匯入備份、清除私人資料。
- 檢視切換：草稿、待整理、已完成。
- 旅程清單：封面、標題、國家、日期、時刻數、待補 YouTube 數與最後更新時間。
- 空狀態：直接提供建立第一趟旅程的操作。

「待整理」包含狀態為 `review` 的旅程。缺少 YouTube 連結、文案或選歌原因只形成 badge 提醒，不阻擋完成。

三個檢視以狀態互斥篩選：`draft` 顯示在草稿、`review` 顯示在待整理、`complete` 顯示在已完成。文案、選歌原因或 YouTube 連結的待補數量以 badge 顯示，不會讓已完成旅程同時出現在其他檢視。

### 5.2 旅程編輯器

桌機採固定且可調整的三區布局：

- 左側：音樂時刻清單、目前選取狀態、拖曳把手、上移與下移按鈕。
- 中間：目前圖片預覽，使用 `object-fit: contain` 保留完整比例，背景提供足夠對比。
- 右側：日期、選填時間、城市、地點、時刻文案、歌名、歌手、YouTube 連結、選歌原因。
- 上方旅程資訊區：標題、國家、城市清單、起訖日期、旅程總文與狀態。

批次選取圖片後，系統依選取順序建立多個音樂時刻，第一則自動被選取。每一則可以獨立保存，不要求一次填完所有照片。

### 5.3 預覽與完成

預覽沿用既有播放器的閱讀體驗，但允許從 `/studio` 讀取草稿。預覽不會改變旅程狀態，也不會自動播放 YouTube。

完成旅程前必須符合：

- 有旅程標題、國家、開始日期與結束日期。
- 開始日期不晚於結束日期。
- 至少有一個音樂時刻。
- 每個音樂時刻都有圖片、日期、歌名與歌手。
- 音樂時刻日期位於旅程日期範圍內；超出時要求修正或明確確認擴大旅程日期。

完成後狀態改為 `complete`，立即出現在 Atlas。完成旅程仍可重新編輯；任何變更經儲存後都會反映到查詢頁與播放器。

狀態轉換規則：

- 新旅程從 `draft` 開始。
- 所有最低條件通過且使用者進入預覽後，旅程可轉為 `review`。
- 只有使用者明確按下「完成旅程」，`review` 才轉為 `complete`。
- 已完成旅程若被編輯到不再符合最低條件，儲存時自動降回 `review`、從 Atlas 移除，並在編輯器明確說明原因。
- 缺少選填的文案、選歌原因或 YouTube 連結不會讓 `complete` 降級。

## 6. 資料模型

### 6.1 Journey

```ts
interface Journey {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  countryCoordinates: [number, number];
  cityLabels: string[];
  startDate: string;
  endDate: string;
  summary: string;
  coverPhotoAssetId?: string;
  status: 'draft' | 'review' | 'complete';
  createdAt: string;
  updatedAt: string;
}
```

國家選擇器使用隨應用程式封裝的非私人國家目錄，提供 ISO 代碼、繁體中文名稱與 Atlas 標記座標，不呼叫地理編碼服務。城市由使用者以標籤形式輸入。

### 6.2 Moment

```ts
interface Moment {
  id: string;
  journeyId: string;
  photoAssetId: string;
  songReferenceId: string;
  localDate: string;
  localTime?: string;
  cityLabel: string;
  placeLabel: string;
  caption: string;
  reason: string;
  reasonStatus: 'complete' | 'needs_review';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

過往旅遊使用使用者看到的當地日期與時間，不在本階段推測或轉換時區。`localTime` 可以留白，播放器只顯示已提供的部分。

### 6.3 SongReference

```ts
interface SongReference {
  id: string;
  provider: 'youtube' | 'manual';
  providerItemId?: string;
  sourceUrl?: string;
  title: string;
  artist: string;
  availability: 'available' | 'invalid_link' | 'needs_link';
}
```

歌名與歌手必填，YouTube 連結選填。有效連結轉成既有隱私強化嵌入網址；無連結使用 `needs_link`；無效連結使用 `invalid_link`，但其他歌曲資料仍可保存。

### 6.4 PhotoAsset

```ts
interface PhotoAsset {
  id: string;
  blob: Blob;
  contentType: string;
  originalFileName: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}
```

資料模型只保存 `photoAssetId`。顯示層在需要時建立 `blob:` URL，元件卸載或圖片切換時撤銷，避免記憶體持續累積。

## 7. Repository 與資料流

既有唯讀 `JourneyRepository` 繼續供 Atlas、國家頁、旅程頁與播放器使用。新增職責分離的編輯介面：

```ts
interface JourneyEditorRepository {
  listPrivateJourneys(): Promise<Journey[]>;
  createJourney(input: NewJourney): Promise<Journey>;
  updateJourney(id: string, patch: JourneyPatch): Promise<Journey>;
  deleteJourney(id: string): Promise<void>;
  addMoments(journeyId: string, photos: File[]): Promise<Moment[]>;
  updateMoment(id: string, patch: MomentPatch): Promise<Moment>;
  deleteMoment(id: string): Promise<void>;
  reorderMoments(journeyId: string, orderedIds: string[]): Promise<void>;
  completeJourney(id: string): Promise<Journey>;
}
```

`IndexedDbJourneyRepository` 實作查詢與編輯介面。所有跨資料表操作使用單一 IndexedDB transaction，例如刪除旅程時必須原子刪除旅程、時刻、歌曲與不再被引用的照片。

查詢端使用組合 repository：

```text
fixture repository ─┐
                    ├─ combined query repository ─ Atlas / Country / Player
IndexedDB repository ┘

IndexedDB repository ─ JourneyEditorRepository ─ Studio
```

組合查詢只從 IndexedDB 讀取 `complete` 旅程；Studio 則可讀取所有私人狀態。

## 8. 自動儲存與狀態

- 文字欄位在使用者停止輸入 500ms 後寫入 IndexedDB。
- 日期、選單、排序、照片加入與刪除立即保存。
- 畫面狀態分為 `saving`、`saved`、`error`，並顯示最後成功儲存時間。
- 新寫入開始前取消尚未送出的 debounce，但不取消已開始的 IndexedDB transaction。
- 寫入失敗時保留 React 表單狀態，提供重試，不顯示錯誤的「已儲存」。
- 離開仍有未送出變更的頁面時，先 flush 自動儲存；失敗時阻止無提示離開。

## 9. 圖片處理

### 9.1 接受格式

- 接受 JPEG、PNG、WebP，以及目前瀏覽器能成功解碼的其他圖片。
- HEIC／HEIF 若無法解碼，顯示明確提示，要求轉為 JPEG 或 PNG。
- 單一輸入檔案上限為 25 MiB；超過時不解碼、不建立音樂時刻。
- 非圖片、空檔案與解碼失敗檔案不會建立音樂時刻。

### 9.2 正規化

- 讀取圖片方向並產生正確方向的顯示版本。
- 保留原始長寬比。
- 對長邊超過 2560px 的照片縮小至 2560px，避免 IndexedDB 與備份無限制成長。
- 不需要透明度的圖片以 WebP quality 0.9 產生顯示版本；IG 截圖若原始尺寸不超過限制，不進行縮小，確保文字仍可閱讀。
- 需要透明度的 PNG 保留透明度；其他圖片可轉成適合瀏覽器顯示的壓縮格式。
- 保存的是 Sound Passport 顯示版本，不承諾保存相機原始解析度。

圖片處理完全在瀏覽器本機進行，不上傳照片、檔名或 EXIF 資料。

## 10. 備份與還原

備份是一個 ZIP 容器，副檔名為 `.soundpassport`：

```text
backup.soundpassport
├─ manifest.json
└─ photos/
   ├─ <photo-id>.<extension>
   └─ ...
```

`manifest.json` 包含：

- 格式識別字與 schema version。
- 匯出時間與應用程式版本。
- journeys、moments、songs 與 photo metadata。
- 每個照片檔案的 SHA-256、byte size 與 content type。

匯入流程：

1. 解析容器並驗證格式識別字與支援版本。
2. 驗證所有必要欄位、資料關聯、照片存在性、大小與 SHA-256。
3. 在記憶體建立匯入計畫，不修改正式資料。
4. 顯示將新增的旅程、時刻與照片數量，取得使用者確認。
5. 空資料庫還原時保留原 ID 與排序。
6. 已有資料且 ID 衝突時，為整組資料產生新 ID 並重寫所有關聯。
7. 以單一 transaction 寫入；任何寫入失敗都 rollback。

匯入採新增模式，不模糊合併同名旅程。刪除單一旅程需要確認對話框；清除全部私人資料需要輸入確認文字；示範 fixture 不受影響。

## 11. 錯誤處理

| 情境 | 行為 |
| --- | --- |
| IndexedDB 無法開啟 | Atlas 仍可顯示示範資料；Studio 顯示不可編輯狀態與重試 |
| 儲存空間不足 | 停止新寫入、保留既有資料、建議匯出備份或刪除內容 |
| 單張圖片失敗 | 其他成功圖片照常加入，列出失敗檔名與原因 |
| 自動儲存失敗 | 保留表單內容，顯示錯誤與重試，禁止誤顯已儲存 |
| YouTube URL 無效 | 保留歌名與歌手，標記連結錯誤，不建立 iframe |
| 備份格式或版本錯誤 | 不修改現有資料，顯示可理解的原因 |
| 備份照片損壞 | 整批拒絕，不留下部分匯入資料 |
| 刪除交易失敗 | rollback，旅程仍完整存在 |

## 12. 隱私與安全

- 私人內容只存在 IndexedDB 與使用者主動下載的備份檔。
- 不把真實旅程、照片、備份或 IndexedDB dump 寫入 Git。
- 不在 console、analytics 或錯誤訊息中輸出私人文案與檔名。
- YouTube iframe 只在使用者進入含有效影片的播放器畫面後載入。
- 沿用 `youtube-nocookie.com`、`autoplay=0`，且 iframe 不取得 autoplay permission。
- 備份下載前提示該檔案含私人照片與文字，應由使用者自行妥善保存。
- 公開 repository 只包含合成文字、小型非私人測試圖片與固定 fixture。

## 13. 無障礙與響應式要求

- 所有欄位都有可見標籤與可程式辨識的錯誤訊息。
- 排序同時提供拖曳與鍵盤可操作的上移／下移按鈕。
- 儲存狀態透過 `aria-live` 宣告，但不在每次按鍵時重複干擾。
- 圖示按鈕使用既有圖示庫或 Lucide，並提供 tooltip 與 accessible name。
- 桌機編輯器在窄視窗改成清單、預覽、欄位的分段布局，不產生水平捲動。
- 手機尺寸只要求 Atlas、國家頁、旅程頁與播放器可正常回放；Studio 顯示建議改用電腦的唯讀提示，不提供完整編輯。
- 直式與橫式圖片都完整顯示，不遮住文案、歌曲資訊或播放器控制。

## 14. 測試策略

### 14.1 Domain 單元測試

- 旅程完成條件與日期範圍。
- YouTube 連結狀態與既有隱私嵌入網址。
- 排序重新編號與刪除後排序。
- 備份 manifest 驗證、版本判斷、SHA-256 與 ID remapping。
- 國家目錄查詢與 Atlas 座標。

### 14.2 IndexedDB integration tests

- 建立、重新開啟、更新、刪除與查詢。
- 旅程、時刻、歌曲、照片的 transaction 原子性。
- schema migration。
- 寫入失敗與 quota 類錯誤映射。
- 只讓 `complete` 私人旅程進入 Atlas 查詢。

### 14.3 UI tests

- 建立旅程與完成條件訊息。
- 批次加入成功與部分圖片失敗。
- 自動儲存狀態與重試。
- 時刻選取、編輯、拖曳替代控制與刪除確認。
- 文案、選歌原因與 YouTube 待補狀態分開顯示。
- 工作台狀態篩選與唯讀示範資料隔離。

### 14.4 Playwright E2E

1. 建立私人旅程並批次加入直式與橫式非私人 fixture 圖片。
2. 輸入旅程總文、時刻文案、歌曲資料與選歌原因。
3. 重新載入頁面，確認草稿、照片與順序保留。
4. 調整排序、預覽、完成，確認 Atlas、國家頁與播放器反映新資料。
5. 確認沒有 YouTube 連結的時刻不阻擋完成，也不產生 iframe。
6. 匯出 `.soundpassport`、清除私人資料、匯入並逐欄比對還原結果。
7. 驗證損壞備份不改動既有資料。
8. 在桌機與手機尺寸檢查圖片比例、文字重疊與水平捲動。
9. 確認導覽與預覽都不會自動播放 YouTube。

測試不得使用真實個人旅行資料。

## 15. 完成條件

- [ ] 使用者可建立、編輯、刪除私人旅程。
- [ ] 旅程可保存國家、城市、日期、標題與旅程總文。
- [ ] 使用者可批次加入並混用直式限動截圖與原始照片。
- [ ] 每個時刻可保存日期、選填時間、城市、地點、文案、歌名、歌手、選歌原因與選填 YouTube 連結。
- [ ] 使用者可拖曳或透過按鈕調整時刻順序。
- [ ] 草稿、自動儲存、重新載入與待補狀態正確運作。
- [ ] 預覽不改變狀態、不自動播放。
- [ ] 只有完成旅程會出現在 Atlas，且可透過既有流程回放。
- [ ] `.soundpassport` 可完整匯出、清除後還原文字、照片、狀態與順序。
- [ ] 匯入驗證與 transaction 可防止部分或損壞資料污染現有內容。
- [ ] 私人資料不會寫入 Git 或送往應用程式後端。
- [ ] 單元測試、IndexedDB integration tests、TypeScript typecheck 與 production build 全部通過。
- [ ] 桌機與手機尺寸 Playwright E2E 全部通過。
- [ ] 直式／橫式圖片沒有錯誤裁切，頁面沒有文字重疊或水平捲動。
- [ ] GitHub Draft PR 已更新，附上驗證結果與本機試用網址。

## 16. 後續階段

本階段驗證整理工作台確實好用後，下一個獨立 Goal 才加入私人帳號、Firebase Storage／Firestore、安全規則、跨裝置同步與手機回顧。屆時應保留本規格的 Repository 契約，將 IndexedDB 作為離線快取或匯入來源，而不是重寫 UI。
