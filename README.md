# Sound Passport

## Firebase 開發環境

先從範例建立本機環境檔，接著分別啟動 Firebase Emulator Suite 與前端開發伺服器：

```powershell
Copy-Item .env.example .env.local
npm.cmd run emulators
npm.cmd run dev
```

正式環境請在 Firebase Console 建立 Firebase Web App，並在 Authentication 的登入提供者中只啟用 Google。將該 Web App 的公開設定填入 `.env.local`，並在 Firebase Console 的 authorized domains 加入需要使用登入功能的網域。

`.env.local` 已刻意忽略，不應提交。Firebase Web config 屬於公開用戶端設定；service-account JSON 則絕不能放入此前端 repository，也不得提交或提供給瀏覽器。

目前里程碑已使用 Firebase Authentication。Firestore rules 僅預留最小 owner-profile contract，應用程式尚未寫入 profile。旅程 metadata 與照片仍儲存在依 `uid` 隔離的本機 IndexedDB，待後續 migration/sync Goal 再處理。

Sound Passport 是一個「預設私人」的旅行音樂日誌。桌機整理工作台可建立旅程、批次加入照片、記錄歌曲與感受，再從世界地圖進入已完成旅程回放；私人內容只保存在目前瀏覽器與使用者主動下載的備份檔。

## 本機執行

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run test:run
npm.cmd run typecheck
npm.cmd run build
npm.cmd exec playwright install chromium
npm.cmd run test:e2e
```

`npm.cmd exec playwright install chromium` 只需在首次執行 E2E 前安裝。`npm.cmd run test:e2e` 會由 Playwright 啟動並關閉 in-process Vite test server，不會重複 build 或留下長駐 server。

## 私人旅程工作台

- Atlas 仍是首頁，只顯示內建示範旅程與狀態為「已完成」的私人旅程。
- `/studio` 提供建立、編輯、排序、預覽、完成、匯出、匯入與清除私人旅程的桌機流程。
- 文字欄位停止輸入 500ms 後自動儲存；日期、選單、照片與排序立即保存。
- 手機尺寸的 Studio 只顯示改用電腦的指引；Atlas、國家頁、旅程頁與播放器仍可完整回放。
- 此版本已有 Google/Firebase Authentication，但尚未提供旅程 metadata 或照片的應用程式後端與雲端同步；資料仍依 `uid` 儲存在本機 IndexedDB，待後續 Goal 進行 migration/sync。也不提供公開分享、YouTube 搜尋或播放清單匯出。

## 圖片處理

- 接受 JPEG、PNG、WebP，以及目前瀏覽器能成功解碼的其他圖片。
- 每個輸入檔案上限為 25 MiB；超過限制、空檔、非圖片或解碼失敗的檔案不會建立時刻。
- 圖片完全在瀏覽器本機處理，保留方向與長寬比，長邊最多 2560px。
- 不需要透明度的圖片會正規化為 WebP quality 0.9；需要透明度的 PNG 保留透明度。
- 本階段不提供 HEIC／HEIF 轉檔。若瀏覽器無法解碼，請先轉成 JPEG 或 PNG。
- IndexedDB 保存的是 Sound Passport 顯示版本，不承諾保留相機原始檔或原始解析度。

## 備份與還原

「匯出私人備份」會下載單一 `.soundpassport` ZIP 容器，包含旅程文字、歌曲資料與正規化照片。匯入前會驗證 schema、資料關聯、照片大小與 SHA-256，並以單一 IndexedDB transaction 寫入；損壞備份不會留下部分資料。

`.soundpassport` 含有私人照片與文字，應存放在可信任的位置。清除瀏覽器網站資料會移除 IndexedDB 內容；需要保留旅程時，請先匯出備份。

## 資料與 Git 隱私

- 真實旅程、照片、檔名與筆記只存在目前 origin 的 IndexedDB，以及使用者主動下載的 `.soundpassport` 檔。
- 應用程式不會把私人內容上傳到後端，也不會將私人資料寫入 repository。
- 公開 GitHub 只包含程式碼、文件、固定示範資料與非私人的合成測試 fixture。
- E2E 的直式與橫式 PNG 在測試記憶體內產生，不提交個人照片、備份、IndexedDB dump、trace、下載或測試結果。

## 地圖資料與視覺基準

世界地圖使用 `world-atlas` 套件內的 Natural Earth 110m 國家邊界 TopoJSON，於本機轉為 GeoJSON 後由 MapLibre 繪製。Natural Earth 資料為 public domain；地圖不依賴遠端 style、tile 或使用者地理資料。

MapLibre canvas 的 desktop/mobile 視覺 snapshots 位於 `e2e/atlas-playback.spec.ts-snapshots/`。只有刻意變更地圖渲染時才更新基準，更新後必須再以一般模式重跑：

```powershell
npm.cmd run test:e2e -- --update-snapshots
npm.cmd run test:e2e
```

## 設計規格

- [私人旅程整理工作台設計](docs/superpowers/specs/2026-07-13-sound-passport-journey-workbench-design.md)
- [繁體中文產品設計規格](docs/superpowers/specs/2026-07-11-sound-passport-design-zh-TW.md)
- [English product design](docs/superpowers/specs/2026-07-11-sound-passport-design.md)
