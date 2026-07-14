# Sound Passport 私人雲端同步與 PWA 設計規格

**日期：** 2026-07-14

**狀態：** 已由使用者逐段核准，待使用者審閱書面規格

**版本：** 0.1

## 1. 目標

本階段要讓 Sound Passport 從單一瀏覽器內的私人旅程工具，演進為可安裝、可離線回顧、可跨裝置同步的私人旅行音樂日誌。使用者以 Google 帳號登入，每個帳號只能存取自己的旅程、歌曲、文案與照片；未登入者仍可操作固定示範旅程了解產品。

核心使用方式維持不變：電腦負責整理，手機負責回顧。手機首頁縮短世界地圖，優先露出最近一趟旅程。IndexedDB 繼續提供本機優先體驗，Firebase 負責私人雲端備份與跨裝置同步。

本規格擴充 2026-07-13 的本機工作台設計。該規格中的旅程模型、圖片正規化、備份格式、桌機編輯器及完成狀態仍然有效；「沒有登入、雲端與跨裝置同步」的限制由本規格取代。

## 2. 已確認的產品決策

- 登入只提供 Google 登入。
- 未登入者可瀏覽東京與首爾示範旅程。
- 登入後的「我的旅行世界」、最近旅程與統計只包含目前帳號的私人旅程。
- 示範旅程不計入私人統計，改由獨立「探索示範」入口存取。
- 第一次登入時，系統先列出本機資料摘要，取得同意後才把既有 IndexedDB 旅程搬到雲端。
- 本機 IndexedDB 是 UI 的主要讀寫來源；Firebase 在背景同步。
- 每位使用者的照片容量上限為 250 MiB，沿用目前 500 張照片上限。
- 容量達 80% 顯示一般提醒，95% 顯示強警告，100% 阻止新上傳。
- 第一版包含登出，以及刪除帳號與全部雲端資料。
- 第一版包含 PWA 安裝、離線回顧與版本更新提示。
- 第一版不包含公開分享、共同編輯、管理員瀏覽私人資料或手機完整編輯器。

## 3. 使用者流程

### 3.1 未登入

1. 使用者進入首頁。
2. 首頁以示範資料顯示世界地圖及一趟最近示範旅程。
3. 使用者可開啟國家、旅程詳情及播放器。
4. 使用者點擊建立、複製、整理或私人資料入口時，系統要求 Google 登入。

### 3.2 第一次登入與本機搬移

1. 使用者完成 Google 登入。
2. 系統檢查目前瀏覽器是否存在尚未歸屬帳號的私人 IndexedDB 資料。
3. 若沒有資料，直接進入空的私人 Atlas。
4. 若有資料，顯示旅程數、照片數、總容量與雲端剩餘容量。
5. 使用者選擇「搬到我的雲端」或「暫時不要」。系統不得在確認前上傳。
6. 搬移完成前，本機資料仍是完整且可恢復的來源。
7. 全部照片與 metadata 完成後，才標記搬移成功；失敗可使用相同 ID 重試，不建立重複檔案。

### 3.3 日常同步

1. 使用者在桌機編輯器操作。
2. 每項變更先保存到 IndexedDB，畫面立即反映。
3. 變更加入本機同步 outbox，狀態顯示「等待同步」。
4. 有網路時，背景同步器把照片與 metadata 寫入使用者自己的 Firebase 路徑。
5. 成功後移除 outbox 項目並顯示「已同步」。
6. 其他裝置登入後，從 Firebase 下載差異並更新該裝置的 IndexedDB 快取。

### 3.4 登出與刪除帳號

- 登出前若仍有未同步變更，必須提醒使用者等待同步或匯出備份，不能靜默丟棄。
- 登出後清除記憶體內的圖片 URL、登入憑證與目前帳號的私人畫面狀態。
- 本機快取依 `uid` 分區，任何其他帳號都不能查詢或顯示前一個帳號的資料。
- 預設在登出後清除目前帳號的本機私人快取；未來若提供「信任這台裝置」才可選擇保留離線資料。
- 刪除帳號前要求重新 Google 驗證，並提醒使用者先匯出備份。
- 刪除工作由可信任後端以可重試工作執行，依序清除 Firestore、Storage、容量帳本及 Firebase Auth 使用者。

## 4. 首頁與資訊架構

### 4.1 未登入首頁

- Header 顯示護照 Logo、世界地圖、整理及 Google 登入。
- 最近旅程區顯示一趟固定示範旅程，明確標示「示範」。
- Atlas、國家頁、旅程詳情與播放器只查詢 fixture repository。
- 建立與整理行為導向 Google 登入，不建立匿名雲端資料。

### 4.2 登入後首頁

- Header 的登入命令改為帳號頭像與帳號選單。
- 最近旅程、國家統計、地圖 marker 與旅程清單只查詢目前 `uid` 的完成旅程。
- 東京與首爾不出現在私人統計或私人 map marker 中。
- 帳號沒有私人旅程時，顯示「建立第一趟旅程」及次要的「查看示範」。
- 示範內容保留獨立入口，但不會與私人 repository 合併計數。

### 4.3 手機第一屏

手機寬度下的順序固定為：

1. 護照 Logo、主要導覽及帳號頭像。
2. 「我的旅行世界」及簡短私人統計。
3. 最近一趟旅程橫向卡片：小型封面、國家、旅程名稱、日期及最近一首歌。
4. 高度約 240 至 280px 的世界地圖。
5. 其他國家與旅程清單。

最近旅程必須在無捲動或只需極少捲動的第一屏範圍內可見。沒有私人旅程時，該位置改為建立第一趟旅程的空狀態；未登入時則顯示示範旅程。

手機仍以回顧為主，不提供完整 Studio。容量達 95% 時才顯示明顯提示，並指引使用者改用電腦整理。

### 4.4 桌機

桌機維持較大的互動地圖、完整 Studio 及三區編輯器。最近旅程可以作為 Atlas 上方的緊湊入口，但不得取代地圖的主要地位。

## 5. PWA 設計

### 5.1 可安裝性

- 提供 Web App Manifest。
- Manifest 包含 `name`、`short_name`、`start_url`、`scope`、`display: standalone`、theme/background colors 及圖示。
- 護照 Logo 延伸為 192px、512px、maskable 及 Apple touch icon。
- 正式站點使用固定 HTTPS origin；不得任意更換網域，避免 IndexedDB 被視為不同資料來源。
- 支援瀏覽器原生安裝；Android/Chromium 可加上明確安裝命令，iOS 提供加入主畫面的簡短指引。

### 5.2 離線範圍

- Service worker precache App shell、hashed JS/CSS、字型、世界地圖邊界及必要固定素材。
- IndexedDB 保存目前帳號的旅程 metadata、正規化照片、同步 outbox 與最後同步容量。
- 已下載的私人旅程可以離線回顧。
- 未曾下載到該裝置的雲端旅程，在離線時顯示清楚的不可用狀態。
- YouTube 不嘗試離線播放，顯示「需要網路才能播放」。
- fixture 遠端圖片應轉為同源固定素材或明確納入 runtime cache，避免示範旅程離線破圖。

### 5.3 更新

- 新 service worker 等待使用者確認後才啟用。
- 編輯中、有未同步 outbox 或正在上傳照片時，不強制重新載入。
- 顯示「有新版本」及重新載入命令；完成更新後保留本機資料與同步狀態。

## 6. 技術架構

### 6.1 選定方案

採用 IndexedDB 本機優先，加上 Firebase 背景同步：

- Firebase Authentication：Google 登入與重新驗證。
- Cloud Firestore：旅程、時刻、歌曲、同步版本與容量帳本。
- Cloud Storage for Firebase：正規化私人照片。
- Cloud Functions / trusted backend：容量預留、帳本核對、帳號刪除及必要清理工作。
- Firebase Security Rules：以 `request.auth.uid` 強制隔離每位使用者。
- Firebase App Check：降低非預期客戶端濫用；本機與測試環境使用官方 debug 流程。

不採用直接以 Firestore 取代本機 repository，因為現有 IndexedDB 已完整支援圖片、離線編輯、衝突處理及備份。也不採用純雲端模式，因為旅行回顧與 PWA 必須能在網路不穩時使用。

### 6.2 本機邊界

- UI 只透過現有 repository ports 存取資料，不直接依賴 Firebase SDK。
- IndexedDB 每筆私人記錄新增 owner `uid` 或使用 uid 分區的 database namespace。
- 同步器透過明確的 cloud ports 讀寫 Firebase。
- Firestore SDK 不另外啟用第二套持久化快取，避免與產品自己的 IndexedDB 產生兩個真相來源。
- fixture repository 永遠唯讀且不進入同步流程。

### 6.3 雲端路徑

```text
Firestore
users/{uid}
users/{uid}/journeys/{journeyId}
users/{uid}/moments/{momentId}
users/{uid}/songs/{songId}
users/{uid}/usage/current
users/{uid}/uploadReservations/{reservationId}

Storage
users/{uid}/photos/{photoId}
```

`users/{uid}` 只保存產品需要的最低資料，例如建立時間、schema version、搬移狀態及刪除狀態。Google email、頭像與顯示名稱由 Auth session 提供，除非有明確產品用途，不重複保存。

### 6.4 版本與衝突

- Journey、Moment 及 Song 保存單調遞增 revision、client mutation ID 與 server timestamp。
- 寫入使用 Firestore transaction 或具前置版本條件的 trusted operation。
- 同一 mutation ID 重試不得重複套用。
- 不同裝置同時編輯同一筆資料時，不使用靜默 last-write-wins。
- 衝突保留本機版本與雲端版本，顯示「其他裝置有較新版本」，讓使用者選擇使用雲端或保留這台版本。
- 新照片與新時刻使用全域唯一 ID，因此可在不衝突時合併；排序衝突以整份最新排序版本處理。

## 7. 圖片同步與容量

### 7.1 固定限制

- 每位使用者最多 500 張照片。
- 每張輸入上限 25 MiB。
- 每張正規化後照片上限 25 MiB。
- 每位使用者正規化照片合計上限 250 MiB（262,144,000 bytes）。
- 圖片維持最長邊 2560px；非透明圖片使用 WebP quality 0.9，透明圖片使用 PNG。

10 位使用者全部使用 250 MiB 時，總容量約 2.44 GiB，低於目前 Cloud Storage 5GB-month 的免費儲存額度。此估算不構成永久價格保證，Firebase 專案仍需 Blaze billing account 與預算告警。

### 7.2 容量帳本

`users/{uid}/usage/current` 至少包含：

```text
usedPhotoBytes
reservedPhotoBytes
photoCount
updatedAt
version
```

- Client 不得自行降低使用量或增加可用額度。
- 上傳前由 trusted backend 以 transaction 建立 reservation，檢查 `used + reserved + incoming <= limit`。
- Storage 規則只允許目前 uid、合法 photo ID、合法 content type、合法 byte size 及有效 reservation 的上傳。
- Object finalize 以 photo ID 冪等地把 reserved bytes 轉為 used bytes。
- 上傳失敗或 reservation 過期時釋放 reserved bytes。
- 刪除照片後以冪等事件扣回 used bytes；定期核對帳本與實際物件，清理 orphan。

### 7.3 UI 門檻

| 使用比例 | 桌機 | 手機 | 上傳行為 |
| --- | --- | --- | --- |
| 0–79% | 帳號選單顯示容量條 | 帳號選單顯示容量 | 正常 |
| 80–94% | 黃色「儲存空間快滿了」提示 | 小型容量標記 | 允許 |
| 95–99% | 珊瑚色強警告及剩餘 MB | 一次性明顯提示，指引用電腦整理 | 允許但先提示 |
| 100% 或預估超過 | 顯示所需、剩餘與需釋放容量 | 顯示唯讀狀態 | 阻止新上傳 |

阻止上傳不影響既有旅程的回顧、備份、刪除或同步文字。提醒提供「管理空間」與「匯出備份」操作；管理空間依旅程列出照片數及容量，讓使用者開啟旅程或刪除整趟旅程。

離線時使用最後同步容量加上本機 pending bytes 做保守預估，標示「上次同步」。恢復網路後若雲端已被其他裝置用滿，照片留在本機 outbox 並顯示可恢復錯誤，不得刪除本機照片。

## 8. 安全與隱私

### 8.1 Security Rules

- 私人 Firestore 與 Storage 路徑的 uid 必須等於 `request.auth.uid`。
- 未登入者不能列出或讀取任何 `users` 路徑。
- Rules 驗證必要欄位、允許欄位、資料型別、合理大小與 owner 不可變。
- Client 不能寫入 server timestamp、容量帳本、刪除狀態或其他可信任欄位。
- 所有 queries 必須以目前 uid 的路徑發出；Rules 不被當成結果篩選器。
- 管理用 service credentials 永遠不進入前端 bundle、repository 或 GitHub secrets 以外的位置。

### 8.2 照片存取

- 不把永久公開 download URL 保存到 Firestore。
- App 以已登入 Firebase SDK 取得 bytes/blob，再建立短生命週期 object URL。
- object URL 在元件卸載、帳號切換及登出時撤銷。
- 瀏覽器快取及 IndexedDB 都以 uid 隔離；另一個登入帳號不能看到前一帳號的本機媒體。

### 8.3 資料最小化

- 旅程預設私人，沒有公開欄位或匿名分享網址。
- 第一版不加入廣告、第三方行為分析或管理員內容瀏覽工具。
- 錯誤紀錄不得包含旅程名稱、文案、精確地點、照片內容、Storage URL 或 Google access token。
- Firebase Web config 不是伺服器密碼；真正的權限邊界是 Authentication、Security Rules、App Check 及 trusted backend。

## 9. 帳號刪除

1. 使用者從帳號選單進入危險操作區。
2. UI 顯示將刪除的旅程數、照片數及容量，並提供匯出備份。
3. 使用者輸入明確確認並重新完成 Google 驗證。
4. Trusted backend 建立唯一 deletion job，立即把帳號標記為 deleting 並阻止新寫入。
5. Job 分頁刪除 Firestore 子集合、Storage prefix、reservation、usage 與其他 owner records。
6. 所有私人資料清除後刪除 Firebase Auth 使用者。
7. Job 可重試並保存非敏感進度；重複呼叫不會恢復資料或重複計費。
8. Client 清除該 uid 的 IndexedDB、Cache Storage、object URLs 及 auth state。

刪除流程不能假設跨 Firestore、Storage 與 Auth 存在單一原子 transaction，因此必須使用 idempotent job 及可驗證的完成條件。

## 10. 錯誤與恢復

- 登入 popup 被阻擋：保留目前頁面，提供重新登入。
- 網路中斷：所有變更保存在本機 outbox，顯示離線狀態。
- 圖片上傳失敗：保留本機 blob 與 reservation 狀態，可重試相同 photo ID。
- Rules 拒絕：停止重試並顯示權限錯誤，不將錯誤當成離線。
- 容量不足：阻止該照片同步，其他文字與既有資料繼續同步。
- 雲端 schema 較新：停止破壞性同步，要求更新 App。
- 跨裝置版本衝突：保存兩個版本並要求使用者選擇。
- Service worker 更新：等待沒有編輯及同步工作時，由使用者確認重新載入。
- 帳號刪除部分失敗：後端 job 重試，帳號維持 deleting 並拒絕一般存取。

## 11. 驗收與測試

### 11.1 單元與整合

- Auth state machine：未登入、登入中、登入、重新驗證、登出及 deleting。
- 同步 outbox：冪等 mutation、重試、順序、離線與成功確認。
- 第一次搬移：明確同意、容量檢查、部分失敗回滾與相同 ID 重試。
- 容量：80%、95%、100%、reservation、finalize、delete 及帳本核對。
- 衝突：不同 revision、使用雲端、保留本機及排序衝突。
- 登出：未同步警告、uid 隔離與本機快取清除。

### 11.2 Firebase Emulator

- 使用者 A 不能讀、列出、建立、更新或刪除使用者 B 的 Firestore 文件。
- 使用者 A 不能讀、寫或列出使用者 B 的 Storage objects。
- 未登入者不能存取任何私人路徑。
- 非法 owner、超大檔案、錯誤 content type、缺少 reservation 及 client 修改 usage 都被拒絕。
- 帳號刪除 job 能清除巢狀資料與 orphan，並可從中斷點重試。

### 11.3 E2E

- 未登入者可以回顧示範，但私人操作要求 Google 登入。
- 登入後 Atlas 只顯示目前使用者資料，示範不計入統計。
- 本機旅程搬移前顯示摘要，拒絕搬移時不上傳。
- 兩個模擬帳號完全隔離。
- 離線建立、恢復網路、照片同步及同步狀態正確。
- 手機第一屏露出最近旅程與緊湊地圖，沒有水平溢出或重疊。
- PWA manifest、service worker、離線啟動、更新提示及 standalone 模式。
- 容量警告及超限阻止。
- 匯出備份、帳號重新驗證及完整刪除。

## 12. 非功能性要求

- 私人資料查詢不能依賴 client-side filter 隔離帳號。
- 同步及刪除工作必須可安全重試。
- 任一失敗不得刪除尚未確認上傳完成的本機資料。
- 正常桌機與手機操作不顯示 Firebase 內部錯誤碼。
- App shell 首次載入及 PWA cache 應控制 bundle 大小；雲端階段應評估 route-based code splitting，改善目前大型單一 bundle 警告。
- 服務成本以低於 10 位使用者、每人 250 MiB 為第一階段假設；設定 billing budget alerts，但不把告警描述為硬性費用上限。

## 13. 推薦交付順序

1. Firebase 專案、Emulator、Google Auth 與 Security Rules 基礎。
2. uid 分區的本機資料與登入前後 query 邊界。
3. Firestore metadata 同步、outbox 與衝突。
4. Storage 圖片同步、容量 reservation 及提醒。
5. 第一次 IndexedDB 搬移。
6. 登出、重新驗證與帳號刪除 job。
7. 手機最近旅程版面及登入前後首頁。
8. PWA manifest、icons、service worker、離線及更新 UX。
9. Emulator 隔離測試、跨裝置 E2E、成本與安全驗收。

此順序先建立身份與資料隔離，再讓真實私人資料進入雲端。任何 production Firebase 寫入都必須等 Security Rules 及 Emulator 隔離測試通過後才啟用。

## 14. 完成條件

- Google 登入後只能看到自己的私人旅程。
- 未登入者只能看到固定示範資料。
- 既有 IndexedDB 資料只在使用者確認後搬移，失敗不遺失本機內容。
- 桌機編輯可離線，恢復網路後同步；另一台裝置能取得更新。
- 250 MiB 容量上限由可信任雲端帳本執行，80%、95%、100% UI 正確。
- 使用者可匯出備份、登出及刪除帳號與全部雲端資料。
- 手機第一屏優先露出最近旅程，地圖不再佔滿主要視野。
- PWA 可安裝、可離線開啟已下載內容，YouTube 離線狀態清楚。
- Firebase Emulator 證明跨帳號讀寫與媒體存取全部被拒絕。
- Production build、單元測試、Emulator tests、桌機與手機 E2E 全部通過。
