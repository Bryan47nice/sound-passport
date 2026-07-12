# Sound Passport

Sound Passport 是一個「預設私人」的旅行音樂日誌，協助旅行者保存某個時刻的照片、地點、歌曲與感受，之後再從世界地圖進入該趟旅程，以可播放的故事重新回味。

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

## 目前版本

目前完成唯讀的「世界地圖 → 國家 → 旅程 → 播放器」流程，資料全部來自 repository 內的示範 fixtures，照片使用遠端示範圖片。這些資料不是使用者資料，也不會寫回任何後端。

目前版本尚未提供：

- 身份驗證或使用者帳號
- Firebase 連線或同步
- 照片與旅程上傳
- 真實個人資料儲存
- 公開分享
- YouTube 搜尋
- 播放清單匯出

## 地圖資料來源

世界地圖使用 `world-atlas` 套件內的 Natural Earth 110m 國家邊界 TopoJSON，於本機轉為 GeoJSON 後由 MapLibre 繪製。Natural Earth 資料為 public domain；地圖不依賴遠端 style、tile 或使用者地理資料。

## 產品方向

- 發完 Instagram 限時動態後，以手機優先的流程快速記錄
- 採用平台中立的歌曲資料，第一階段完整支援 YouTube
- 可將已完成旅程的歌曲依順序匯出為 YouTube 播放清單
- 以世界地圖作為旅行記憶的主要入口
- 依序從國家進入旅程，再播放完整故事
- 所有紀錄預設私人，只有使用者主動發布的內容才能公開分享

## 設計規格

- [繁體中文產品設計規格](docs/superpowers/specs/2026-07-11-sound-passport-design-zh-TW.md)
- [English product design](docs/superpowers/specs/2026-07-11-sound-passport-design.md)

## 資料與隱私

目前沒有 Firebase、Authentication、Security Rules、App Check 或任何部署憑證。未來若接上後端，使用者旅程、照片、位置與歌曲筆記必須維持預設私人，伺服器端憑證與其他敏感資訊不得提交至 Git。
