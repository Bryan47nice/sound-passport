# Sound Passport 產品設計規格

日期：2026-07-11  
狀態：已核准，可進入實作規劃

## 1. 產品摘要

Sound Passport 是一個「預設私人」的旅行音樂日誌，服務那些會刻意替旅行時刻搭配音樂的人。它保存某首歌為什麼屬於某個地點，並把這些音樂時刻串成一段可播放、可從世界地圖重新進入的旅行故事。

這個產品不是行程規劃工具、一般相簿或串流音樂服務。它的核心承諾是：

> 保存一個旅行時刻與當時的歌曲，之後再從地圖回到那趟旅程，依序播放完整故事。

## 2. 目標使用者

第一階段的目標使用者，是重視 Instagram 限時動態氛圍，並且會依國家、城市、場景或心情刻意選歌的旅行者。

第一批使用者原本就有以下行為：

- 旅行時拍攝照片或短片。
- 挑選部分時刻發布到 Instagram 限時動態。
- 在旅行當下選歌，而不是回國後才統一處理。
- 事後將這些歌曲整理成播放清單，藉此回味旅程。
- 希望記得每首歌對應的地點、順序與選歌原因。

## 3. 問題定義

Instagram 能保存已發布的限時動態，但它不是長期的旅行音樂資料庫。YouTube 與其他音樂服務能保存歌曲，卻無法保存讓歌曲產生意義的照片、地點、順序與選歌原因。

目前缺少的是一種完整的旅行記憶單位，能同時包含：

- 一張照片或簡短的視覺紀錄；
- 地點與時間；
- 平台中立的歌曲資料；
- 為什麼這首歌適合當下的簡短說明；
- 它在整趟旅程中的順序。

## 4. 產品原則

1. 記錄流程必須融入既有旅行習慣，而不是取代 Instagram。
2. 只有系統無法可靠推測的資料，才要求旅行者親自確認。
3. 歌曲連結可能失效，但旅行記憶本身必須保留。
4. 世界地圖是記憶索引，不是行程規劃地圖。
5. 所有個人資料預設私人，只有擁有者主動發布的內容才能公開。
6. 第一版只聚焦於記錄、整理、回放與分享。

## 5. 核心體驗

### 5.1 建立旅程

使用者建立一趟旅程時，輸入：

- 旅程名稱；
- 國家；
- 一個或多個城市；
- 開始與結束日期；
- 選填的封面照片。

當目前日期落在旅行期間內，系統會將該旅程視為「進行中旅程」，並在新增音樂時刻時自動帶入。

### 5.2 記錄音樂時刻

發布 Instagram 限時動態後，使用者開啟 Sound Passport，依序完成三個步驟：

1. 從裝置的系統相片選擇器挑選照片，再確認系統推測的地點與進行中旅程。
2. 搜尋 YouTube、貼上支援的連結，或手動輸入歌曲資料。
3. 選填一句「為什麼是這首歌？」，然後儲存。

PWA 無法在未經使用者操作的情況下讀取相簿，因此必須開啟系統相片選擇器；一般情況下，最近拍攝的照片會優先顯示。當使用者已選好照片、地點推測正確，且歌曲出現在第一批搜尋結果時，理想流程應能在約 15 秒內完成。若略過選歌原因，該時刻會進入旅後待整理清單，而不會阻擋當下記錄。

### 5.3 旅後整理

使用者可以：

- 調整音樂時刻的順序；
- 修正日期與地點；
- 替換已失效的歌曲連結；
- 補上缺少的選歌原因；
- 選擇旅程封面；
- 預覽完整的可播放旅行故事。

### 5.4 從世界地圖回到旅程

登入後的首頁是一張完整世界地圖，曾經去過的國家會以標記或醒目樣式呈現。

已核准的導覽方式採用「先瀏覽、再播放」：

1. 選擇一個國家。
2. 查看前往該國家的所有旅程。
3. 選擇其中一趟旅程。
4. 從第一個音樂時刻開始播放旅行故事。

只選擇國家時，絕不自動播放聲音。

### 5.5 播放旅程

旅程播放器會依使用者整理後的順序呈現音樂時刻。每個時刻包含照片、城市層級的地點標籤、當地日期與時間、歌曲資料，以及選歌原因。

YouTube 內容透過官方嵌入式播放器播放。其他音樂平台在第一版會開啟原始來源連結。播放動作由使用者控制，進入國家頁或旅程頁時不會自動播放音訊。

### 5.6 發布與分享

所有旅程預設私人。只有使用者主動按下發布時，系統才會建立一份移除敏感資訊、唯讀且可以撤銷的公開快照。

公開快照只包含使用者核准分享的欄位，不包含精確座標、私人草稿、內部識別碼、帳號資訊或未發布的音樂時刻。取消發布後，公開連結立即失效，但私人旅程不會被刪除。

## 6. MVP 範圍

### 包含

- 帳號驗證。
- 建立與編輯旅程。
- 快速記錄音樂時刻。
- 照片上傳與壓縮。
- 透過系統相片選擇器由使用者明確選取照片。
- 自動建議進行中旅程與目前位置。
- 所有自動建議都提供手動備援方式。
- YouTube 搜尋、連結解析、歌曲資料與嵌入式播放。
- 將旅程中的歌曲依順序匯出至使用者自己的 YouTube 播放清單。
- 平台中立的手動歌曲資料。
- 旅後排序與完成度檢查。
- 可由國家深入至旅程的互動式世界地圖。
- 可播放的旅行故事。
- 預設私人的資料儲存。
- 明確的發布、分享與取消發布操作。

### 不包含

- 行程、機票、住宿或預訂管理。
- Instagram 限時動態匯入或 Instagram 帳號整合。
- 社群動態、追蹤、按讚或留言。
- 多人共同編輯旅程。
- AI 歌曲推薦。
- Spotify 或 Apple Music 的完整整合。
- 儲存本機音訊檔案。
- 自動背景位置紀錄。

## 7. 資訊架構

產品分成五個主要區域：

1. **Atlas**：世界地圖、去過的國家，以及國家層級的旅程清單。
2. **Journey**：旅程資料、音樂時刻、整理與發布控制。
3. **Moment Capture**：照片、地點、歌曲與選歌原因的快速記錄。
4. **Player**：依序呈現照片與播放音樂。
5. **Sharing**：移除敏感資訊的公開快照與撤銷機制。

這些區域必須維持為職責清楚的獨立模組，並透過明確的資料契約溝通。如此一來，即使未來更換地圖渲染方式、歌曲來源或儲存服務，也不需要重寫整個產品。

## 8. 資料模型

### User

- `id`
- `displayName`
- `createdAt`
- `settings`

### Journey

- `id`
- `ownerId`
- `title`
- `countryCode`
- `cityLabels`
- `startDate`
- `endDate`
- `coverPhotoId`
- `status`：`active`、`review` 或 `complete`
- `createdAt`
- `updatedAt`

### Moment

- `id`
- `journeyId`
- `ownerId`
- `photoId`
- `takenAt`
- `coordinates`：有權限時保存私人的經緯度
- `placeLabel`：顯示給使用者看的地點名稱
- `cityLabel`
- `songReferenceId`
- `reason`
- `reasonStatus`：`complete` 或 `needs_review`
- `sortOrder`
- `createdAt`
- `updatedAt`

### SongReference

- `id`
- `provider`：`youtube`、`external` 或 `manual`
- `providerItemId`
- `sourceUrl`
- `title`
- `artist`
- `thumbnailUrl`
- `durationSeconds`
- `availability`：`available`、`unavailable` 或 `unknown`
- `lastCheckedAt`

即使外部歌曲來源失效，歌曲名稱、歌手與其他中繼資料仍會保留。

### PhotoAsset

- `id`
- `ownerId`
- `storagePath`
- `contentType`
- `width`
- `height`
- `capturedAt`
- `uploadStatus`

### PublishedJourney

- `publicId`
- `sourceJourneyId`
- `ownerId`
- `publishedAt`
- `updatedAt`
- `revokedAt`
- `snapshot`：只包含經過隱私處理的旅程與音樂時刻欄位

公開文件是一份獨立快照，不是放寬私人資料集合的讀取權限。

## 9. 技術架構

### 前端

- React 與 Vite。
- 手機優先的漸進式網頁應用程式（PWA）。
- 使用 MapLibre GL JS 建立互動式世界地圖。
- 使用 YouTube IFrame Player API 播放音樂。
- 以本機持久化儲存保存未完成記錄與等待上傳的草稿。

### Firebase

- Firebase Authentication：使用者身分驗證。
- Cloud Firestore：儲存使用者、旅程、音樂時刻、歌曲資料與公開快照。
- Cloud Storage：儲存壓縮後的照片。
- Cloud Functions：執行需要權限的操作、代理 YouTube 中繼資料、建立公開快照與撤銷發布。
- Firebase App Check 與嚴格的 Security Rules：保護資料庫與檔案存取。

Cloud Storage 需要使用 Blaze 計費方案。公開發布前必須設定預算警示、上傳大小限制、圖片壓縮與用量監控。

### 外部音樂服務

- YouTube 是第一個完整支援的歌曲來源。
- YouTube Data API 負責搜尋與播放清單相關資料。
- 只有使用者要將旅程匯出成自己的 YouTube 播放清單時，才要求 YouTube OAuth 授權。
- 官方 IFrame Player 負責播放。
- 伺服器端 YouTube 憑證絕不傳送至前端，也不得提交至 Git。
- 其他音樂平台先統一儲存為外部連結，直到確定有足夠需求才建立專用介接層。

## 10. 資料流程

### 記錄音樂時刻

1. 前端立即建立本機草稿。
2. 使用者選擇照片，並確認或修改系統推測的旅程與地點。
3. 歌曲搜尋回傳統一格式的 `SongReference` 候選資料。
4. 前端儲存旅程與音樂時刻資料。
5. 照片透過可恢復的上傳任務傳送。
6. 只有資料與照片狀態都可靠保存後，草稿才會標記為同步完成。

### 播放旅程

1. Atlas 載入使用者去過的國家摘要。
2. 選擇國家後，載入該國家的所有旅程。
3. 選擇旅程後，依 `sortOrder` 載入音樂時刻。
4. Player 透過對應的歌曲來源介接層解析每個 `SongReference`。
5. 若歌曲來源失效，改為顯示已保存的歌曲資料與「替換連結」操作。

### 匯出 YouTube 播放清單

1. 使用者從已完成的旅程選擇匯出。
2. 應用程式只要求建立播放清單所需的最小 YouTube OAuth 權限。
3. 後端建立播放清單，並依旅程順序加入可用的 YouTube 項目。
4. 手動輸入或非 YouTube 的歌曲會標示為略過，不會阻擋整體匯出。
5. 拒絕 OAuth、超過 API 配額或部分失敗，都不得修改私人 Sound Passport 旅程。

### 發布旅程

1. 擁有者預覽旅程。
2. 後端函式驗證旅程擁有權。
3. 函式移除私人欄位，建立 `PublishedJourney` 快照。
4. 公開頁面只讀取這份經過隱私處理的快照。
5. 取消發布時，快照標記為已撤銷，後續公開讀取全部拒絕。

## 11. 隱私與安全

- 公開 GitHub repository 只公開應用程式原始碼與文件。
- 私人資料集合要求使用者完成登入，且帳號 ID 必須符合資料的 `ownerId`。
- 檔案儲存路徑依擁有者區隔，並由 Security Rules 驗證。
- 公開頁面絕不直接查詢私人的旅程或音樂時刻集合。
- 公開快照移除精確座標，只顯示國家或城市標籤。
- Firebase 前端設定可能公開，但它不是授權機制；真正的存取控制由 Security Rules 與 App Check 執行。
- 伺服器憑證、Service Account、部署權杖與非 Firebase API 金鑰一律放在受管理的 Secrets 中。
- Repository 歷史與 CI 日誌皆視為公開資訊，不得出現使用者資料或憑證。

## 12. 失敗處理

- **未允許定位權限**：讓使用者手動選擇國家與城市，不阻擋儲存。
- **地點推測錯誤**：儲存前後都可以修正。
- **沒有網路**：保留本機草稿，並將資料同步排入佇列。
- **照片上傳中斷**：保留草稿，恢復連線後繼續或重新上傳。
- **YouTube 搜尋失敗**：允許手動輸入歌名與歌手。
- **影片遭移除或無法播放**：保留旅行記憶，並提供替換來源功能。
- **YouTube 匯出遭拒或超過配額**：私人旅程保持不變，回報略過項目並允許重試。
- **重複儲存**：使用前端產生的 idempotency key 避免建立重複音樂時刻。
- **發布失敗**：私人旅程保持不變，顯示可重試的錯誤。
- **公開旅程已撤銷**：回傳中性的無法瀏覽頁面，不洩漏私人資料。

## 13. 測試策略

### 單元測試

- 音樂時刻排序與重新排序後的持久化。
- 歌曲 URL 解析與來源格式統一。
- 公開快照的敏感資料移除。
- 權限判斷與資料擁有權檢查。
- 歌曲來源失效時的備援行為。

### 整合測試

- 透過 Firebase Emulator 驗證 Firestore 與 Storage Security Rules。
- 離線草稿恢復連線後的同步。
- 可恢復照片上傳與中斷復原。
- YouTube 中繼資料介接成功、配額錯誤與無結果情境。
- YouTube 播放清單匯出成功、略過項目、拒絕授權與部分失敗情境。
- 發布與取消發布的完整快照生命週期。

### 端對端測試

- 建立旅程、新增音樂時刻，並在 Atlas 看到對應國家。
- 選擇國家、選擇旅程，再依順序播放故事。
- 在不暴露憑證的前提下，依旅程順序匯出可用的 YouTube 歌曲。
- 在定位或 YouTube 搜尋無法使用時，仍能完成記錄。
- 發布旅程、確認公開欄位已移除敏感資訊，再取消發布。
- 於代表性的手機與桌面尺寸驗證主要流程。

## 14. 產品驗收條件

當下列條件全部成立時，MVP 才能開放給第一批外部使用者：

- 旅行者能在手機上建立旅程並保存有效的音樂時刻。
- 開啟表單並選好照片後，理想流程可在約 15 秒內完成。
- 離線或中斷的記錄不會消失，並能在之後完成同步。
- 世界地圖能正確依國家與旅程整理重複造訪。
- 播放器維持使用者整理的順序，且導覽過程不會自動播放聲音。
- 歌曲來源被移除時，對應旅行記憶仍然存在。
- 已完成的旅程能依順序匯出可用的 YouTube 歌曲，且不支援的歌曲會清楚回報、不造成資料遺失。
- 其他已登入帳號無法讀取不屬於自己的私人紀錄。
- 公開分享只暴露經過隱私處理的快照，並且可以撤銷。

## 15. 參考資料

- YouTube IFrame Player API：https://developers.google.com/youtube/iframe_api_reference
- YouTube Data API playlist items：https://developers.google.com/youtube/v3/docs/playlistItems/insert
- YouTube OAuth：https://developers.google.com/youtube/v3/guides/authentication
- MapLibre GL JS：https://maplibre.org/maplibre-gl-js/docs
- Firebase 離線資料：https://firebase.google.com/docs/firestore/manage-data/enable-offline
- Firebase 檔案上傳：https://firebase.google.com/docs/storage/web/upload-files
- Firebase API keys：https://firebase.google.com/docs/projects/api-keys
- Firestore Security Rules：https://firebase.google.com/docs/firestore/security/get-started
- Storage Security Rules：https://firebase.google.com/docs/storage/security
- GitHub repository visibility：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility

