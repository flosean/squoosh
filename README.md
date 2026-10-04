# Squoosh 批次圖片壓縮

在 Windows／瀏覽器中批次壓縮 JPG、PNG、WebP、AVIF。圖片與輸出資料夾設定都留在本機，不會上傳，也不使用 Google Analytics。

## Windows 執行方式

雙擊專案根目錄的 **`Squoosh-Batch-Windows.exe`**，不需要安裝 Node.js。啟動器會開啟 `http://localhost:5000`，並在系統匣提供「開啟 Squoosh」與「結束 Squoosh」。

1. 在「預設輸出資料夾」選好資料夾並允許寫入；之後會記住，不必每批重選。可隨時變更或清除設定。
2. 選取／拖入圖片，按「全部壓縮」。遇到同名檔案或資料夾會自動編號。
3. 右上角「外觀」可選 **明亮／暗色**。首次依系統主題顯示，手動選擇後會記住並同步同一來源的其他視窗。
4. 處理中可取消。動畫原樣複製；重新編碼變大時保留較小原檔內容。

瀏覽器可能要求重新授予資料夾寫入權限。清除網站資料、改用其他瀏覽器設定檔或網址後，需重新設定。使用方式、更新步驟與離線限制見 [BATCH-README.md](BATCH-README.md)。

## 開發與驗證

需要 Node.js **22.12 或以上**；Windows 打包另需系統內建的 .NET Framework C# 編譯器。

```sh
npm ci
npm run build
npm run dev
```

`npm run dev` 支援 Windows，預設綁定 loopback 的 5000 埠；以 `DEV_PORT` 改埠，Ctrl+C 結束。`npm run watch` 只監看建置。正式輸出在 `build/`。

```sh
npm test
npm run test:browser
npm run test:native
npm run test:performance
npm run package:windows
npm run test:windows
```

- 邏輯測試：取消、格式辨識、輸出路徑／撞名、像素與資源上限。
- 瀏覽器測試：真正 WASM 編碼、持久資料夾、明暗主題、跨視窗、離線首次使用、模組失敗、Worker 取消。
- 原生解碼測試：QOI、WebP、AVIF 的截斷、隨機、有限 payload mutation 與失敗後重用；不是窮盡式安全證明。
- 效能測試：連續三批、每批四張 2048×2048 PNG，記錄時間、子 Worker 建立／關閉及主 Worker 數。
- EXE 測試：啟動身分、重複啟動、缺檔與同大小損壞修復、埠號衝突，再重跑瀏覽器測試。

瀏覽器測試預設使用本機 Microsoft Edge；設定 `BROWSER_CHANNEL=chrome` 可改用 Chrome。測試使用隔離設定檔與 OPFS，不寫入使用者的圖片資料夾。原生資料夾選擇器和系統匣 UI 不在自動測試範圍。

## 架構與資源

`BatchCompress` 負責介面與佇列，`codec.ts` 處理解碼／編碼派送，`output-directory.ts` 管理目錄權限、持久化與同源寫入鎖；WorkerBridge 負責失敗、取消與生命週期。

- 預設只打包批次使用的 codec；`lib/batch-features.js` 同時產生 Worker 與離線快取清單。
- 可同時處理一或兩張，依瀏覽器回報的核心與記憶體調整；OxiPNG 每個實例最多四個計算執行緒。
- AVIF 使用背景 Worker 內的單執行緒 codec，避免多執行緒版本在部分透明圖片上偶發停滯；仍可取消，但未啟用 AVIF 多核心加速。
- 單張檔案上限 128 MB、靜態圖片上限 3200 萬像素；像素 buffer 以 transferable 傳給 Worker，結束時釋放 bitmap 與閒置 Worker pool。這些是工作量限制，不是瀏覽器整體記憶體硬上限。
- Service Worker 完成所有必要變體的快取後才啟用。啟動器對內嵌資源做 SHA-256 比對，建置亦產生 `build/build-manifest.json`，記錄來源摘要與資源雜湊。

原版編輯器及其他 codec 來源保留。驗證完整 codec 集合（PowerShell）：

```powershell
$env:SQUOOSH_FULL_CODECS='1'
npm run build
npm run test:full-codecs
Remove-Item Env:\SQUOOSH_FULL_CODECS
npm run build
```

原生重建方法與驗證紀錄見 [CODE-AUDIT-2026-10-03.md](CODE-AUDIT-2026-10-03.md)。重建 codec 後必須一併提交對應 JS／WASM；不要單獨修改產生的 JS。

## 授權與貢獻

基於 [GoogleChromeLabs/Squoosh](https://github.com/GoogleChromeLabs/squoosh)，採 Apache-2.0。貢獻規範與 Google CLA 說明見 [CONTRIBUTING.md](CONTRIBUTING.md)。
