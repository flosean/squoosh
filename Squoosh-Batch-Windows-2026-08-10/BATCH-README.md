# Node 啟動版本

一般 Windows 使用者請執行上一層的 `Squoosh-Batch-Windows.exe`，不需安裝 Node.js。

此資料夾保留需要 Node.js 的啟動方式：

1. 安裝 Node.js 22.12 或以上。
2. 雙擊 `start-batch-compressor.cmd`，保持命令提示字元視窗開啟。
3. 在 `http://localhost:5000` 使用工具，結束時按 Ctrl+C。

若從 GitHub 下載原始碼而沒有 `build/`，請先在專案根目錄執行 `npm ci`、`npm run package:windows`；打包指令同時更新此處的網頁資源。

預設輸出資料夾、明暗主題與其他操作見上一層的 [使用說明](../BATCH-README.md)。請勿同時執行 Node 與 EXE 版本，兩者使用相同的 5000 埠。
