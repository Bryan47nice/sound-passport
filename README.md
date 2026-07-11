# Sound Passport

Sound Passport 是一個「預設私人」的旅行音樂日誌，協助旅行者保存某個時刻的照片、地點、歌曲與感受，之後再從世界地圖進入該趟旅程，以可播放的故事重新回味。

## 產品方向

- 發完 Instagram 限時動態後，以手機優先的流程快速記錄
- 採用平台中立的歌曲資料，第一階段完整支援 YouTube
- 可將已完成旅程的歌曲依順序匯出為 YouTube 播放清單
- 以世界地圖作為旅行記憶的主要入口
- 依序從國家進入旅程，再播放完整故事
- 所有紀錄預設私人，只有使用者主動發布的內容才能公開分享

## 目前狀態

產品設計已完成並記錄，尚未開始實作。

- [繁體中文產品設計規格](docs/superpowers/specs/2026-07-11-sound-passport-design-zh-TW.md)
- [English product design](docs/superpowers/specs/2026-07-11-sound-passport-design.md)

## 隱私邊界

這個 repository 預計維持公開，因此應用程式原始碼與文件可被任何人查看；但使用者的旅程、照片、位置與歌曲筆記會儲存在 Firebase，除非擁有者主動發布經過隱私處理的旅程快照，否則一律保持私人。

伺服器端 YouTube 憑證、部署憑證與其他敏感資訊不得提交至 Git。Firebase 前端設定只用來識別專案，真正的存取控制由 Firebase Authentication、Security Rules 與 App Check 執行。

