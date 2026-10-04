# Squoosh 程式架構與缺陷檢查

## 修正進度（2026-10-04）

本節記錄修正後的狀態；「初次檢查報告」以下保留當時發現與舊行號，不能用來判斷目前是否仍有相同缺陷。B01–B09 已修正並建立正式回歸測試。

- 新增可持久儲存、變更與清除的預設輸出資料夾。使用 IndexedDB 儲存真正的目錄 handle，重新開啟瀏覽器後可沿用；需要時由使用者重新授予寫入權限。
- 動畫原樣複製、相容 AVIF 識別、跨視窗 Web Locks 寫入、資料夾撞名避讓、Worker／頁面模組失敗回報及整批取消均已完成。
- Service Worker 在離線資源全部快取完成後才啟用，包含單／多執行緒變體；已測試四種格式首次離線使用。
- Windows 開發指令改為 Node 啟動程式，實測 watch 模式 TypeScript 零錯誤、HTTP 200 與 COEP 標頭。
- EXE 改由系統匣管理生命週期，取消 10 分鐘自動停止；增加服務身分／版本檢查、遺失或長度不符資源修復、讀取逾時與標頭長度上限。
- 舊編輯器左右結果清除、設定等價判斷、HQX 裁切座標已修正；移除原版 GA、補 UTF-8 宣告並釋放 ImageBitmap。
- `npm test` 驗證邏輯與取消收尾；`npm run test:browser` 驗證真實 codec、OPFS 寫入、離線、失敗恢復、權限流程與重新啟動後設定；`node tests/windows-launcher.cjs` 對實際 EXE 重跑瀏覽器測試、重複啟動、缺檔修復、埠號衝突與 Node 錯誤 URL。

- 新增明亮／暗色切換，首次跟隨系統，手動選擇持久保存、跨視窗同步；停用 storage 時仍可切換並告知無法記住。
- QOI 解碼失敗先檢查空指標；WebP 使用正確的 `WebPFree`，WebP／AVIF 原生 fallback 在配置像素 buffer 前限制尺寸；AVIF 檢查配置與轉換失敗。WP2 編解碼均使用與 ImageData 相同的未預乘 RGBA。
- 已重建 QOI、WebP、AVIF、MozJPEG、JXL、WP2、ImageQuant、VisDiff、OxiPNG、PNG、Resize、HQX、Rotate 共 13 個 codec／處理器的產物，包含 Makefile 定義的 ST、MT、SIMD、Node 變體。
- AVIF 使用 Emscripten 3.1.50、libaom 3.9.1，原生函式連結失敗不再被忽略。多執行緒 AVIF 在半透明 513×257 樣本仍有間歇性停滯，因此正式與完整功能建置均選用單執行緒 AVIF，並排除未使用的 MT 資產；這是可驗證的避讓措施，不代表上游 pthread 問題已修復。其餘多執行緒 codec 有明確 pool 上限。
- 升級 Rollup／PostCSS／壓縮與建置依賴，npm audit 由 82 項降至 0 項已知警示；`@web/rollup-plugin-import-meta-assets` 固定在 2.0.2，避開新版不需要的動態匯入相依鏈。
- 預設建置只包含四種批次格式，保留完整 codec 建置模式。抽出 codec 派送與資源預算；佇列同時 1–2 張、OxiPNG 最多 4 個計算執行緒、單檔 128 MiB／靜態圖 3200 萬像素，傳送像素使用 transferable。Worker 正常結束時明確關閉子 Worker，卡住時仍有強制取消。
- EXE 對解壓資源做 SHA-256 檢查，能修復同大小毀損；建置 manifest 記錄來源摘要與所有輸出檔案雜湊。

### 原生重建

以下為本次使用的 Docker 工具鏈；腳本在容器 Linux 暫存目錄編譯，codec 成功後才複製 JS／WASM 回專案。AVIF 必須使用 3.1.50，其他 C++ 使用 2.0.34。Rust 使用既有鎖定 nightly 與各 crate 的 Cargo.lock。

```powershell
docker build -f codecs/cpp.Dockerfile -t squoosh-cpp codecs
docker build -f codecs/cpp.Dockerfile --build-arg EMSDK_VERSION=3.1.50 -t squoosh-cpp-avif codecs
docker build -f codecs/rust.Dockerfile --build-arg RUST_IMG=rustlang/rust@sha256:5fd16a5576c22c8fdd5d659247755999e426c04de8dcf18a41ea446c5f253309 -t squoosh-rust-audit codecs
docker run --rm -v "${PWD}:/repo" squoosh-cpp sh /repo/lib/rebuild-cpp-codecs.sh qoi webp mozjpeg jxl wp2 imagequant visdif
docker run --rm -v "${PWD}:/repo" squoosh-cpp-avif sh /repo/lib/rebuild-cpp-codecs.sh avif
docker run --rm -v "${PWD}:/repo" squoosh-rust-audit sh /repo/lib/rebuild-rust-codecs.sh oxipng png resize hqx rotate
```

### 驗證範圍與限制

正式測試位於 `tests/`。原生 malformed 測試包含 QOI 418、WebP 512、AVIF 512 個案例；完整 Worker API 另對五個解碼器各測 64 個失敗輸入並驗證恢復，Rust PNG 有 64 個截斷案例。七種 encoder 驗證一般圖片、1×1／17×9／513×257 半透明輸入，並測試旋轉、HQX、Resize、ImageQuant、VisDiff。這是有限的、可重現的 mutation／截斷測試，並非覆蓋率導向的長期 fuzz campaign，也不能保證第三方 codec 沒有漏洞。

效能測試連續三批、每批四張 2048×2048 PNG，觀察子 Worker 建立／關閉與主 Worker 數。資源限制屬工作量預算，不是瀏覽器整體 RAM 的硬上限；不以 DevTools 已關閉的 target 紀錄判斷 Worker 洩漏，也不宣稱未經對照實驗的加速倍率。

本機最終批次建置的 `build/c` 為 5,761,388 bytes，初始為 18,180,072 bytes，減少約 68%。Edge 154、24 個邏輯核心／瀏覽器回報 32 GB 的上述 PNG 工作量，三批耗時 1909／840／1382 ms，中位數 1382 ms；24 個子 Worker 全部關閉、6 個主 Worker 正常回覆收尾，結束後主 Worker 為 0，峰值 2。數值只代表此機器、此樣本。

瀏覽器測試使用 OPFS 與模擬 permission 狀態，未自動操作 Windows 原生目錄選擇器；系統匣互動亦未以 UI 自動化驗證。跨視窗鎖的範圍是相同瀏覽器儲存分區與來源，不協調其他程式或不同瀏覽器設定檔。取消／寫入失敗可能留下空白預留檔，重試會避讓。

## 初次檢查報告（歷史紀錄，以下未更新行號）

檢查日期：2026-10-03（Asia/Taipei）。檢查對象包含目前工作目錄的未提交修改、批次壓縮功能、現有 Windows EXE、原版 Squoosh 程式，以及隨附的 Node 啟動版本。

結論：一般靜態圖片的主要壓縮流程可用，但存在資料內容流失、跨視窗輸出覆寫、離線功能不完整等問題。這次重現了 9 項目前可觸發的缺陷，另外記錄舊路徑問題、啟動器風險及效能改善方向。尚未修改應用程式原始碼或重新打包 EXE。

## 檢查與證據範圍

- Windows，Node.js v24.16.0，npm 11.13.0，Edge 154.0.4258.37。
- `npm run build` 成功，Rollup 顯示約 20.7 秒；`git diff --check` 通過，Git 另有既存 CRLF 提示。
- 實際執行現有 `Squoosh-Batch-Windows.exe --no-browser`，驗證首頁 HTTP 200、標頭與瀏覽器載入；首頁內容與本次建置的 `build/index.html` 完全一致。這項比對不代表已逐一比對 EXE 內所有資源。
- 在隔離的 Edge 環境執行真正的瀏覽器解碼、WASM 編碼與檔案寫入；將資料夾選擇器替換為瀏覽器 OPFS 目錄，避免寫入使用者圖片資料夾。因此沒有驗證 Windows 原生資料夾選擇器與 NTFS 權限介面。
- 靜態 JPG、PNG、WebP、AVIF 各一個樣本成功，輸出均可由 Pillow 讀取；單一批次的既有同名檔案與重複輸入能自動編號。
- 動畫、AVIF 相容品牌、離線、載入失敗、跨視窗競爭、資料夾撞名與 Node 伺服器異常請求均有針對性測試。
- 原始碼閱讀涵蓋入口、批次 UI、Worker bridge、Service Worker、Rollup 外掛、原版編輯器與多個 C++／Rust codec 包裝層。沒有重建全部原生 codec、逐行驗證第三方 codec 原始碼、進行 fuzzing 或大型圖片長時間壓力測試，不能據此保證沒有其他 Bug。

暫存測試程式與結果位於 [`.tmp/audit`](/C:/Users/david/Documents/Code/Squoosh/.tmp/audit)，包括 `browser-audit.cjs`、`exe-audit.cjs`、`logic-audit.cjs` 及對應 JSON。這些是本次檢查工具，尚未建立正式回歸測試套件。

## 架構現況

```text
Windows EXE / Node 啟動器
  → loopback HTTP server
  → static-build 產生的 HTML + initial-app
  → BatchCompress（UI、佇列、檔名分配、檔案寫入）
  → 瀏覽器解碼 + WorkerBridge / Comlink
  → features-worker → 各格式 WASM encoder

Service Worker：獨立負責離線快取與版本更新
Rollup 自訂外掛：產生 feature-meta、Worker API、CSS 型別與資產路徑
原版 Compress / Intro：仍留在來源，但目前首頁不再導向這些介面
```

將 codec 工作放到 Worker、每次最多處理兩張、保留較小原檔，以及抽離 codec 的方向合理。主要問題集中在批次作業生命週期、輸出協調、離線能力偵測與兩套產品程式混存。

## 已重現的缺陷

### B01 · P1：動態 WebP／APNG 靜默變成單張圖片

位置：[BatchCompress/index.tsx:281](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/BatchCompress/index.tsx:281)、[util/index.ts:138](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/util/index.ts:138)。

`createImageBitmap → ImageData → 靜態 encoder` 只處理一幀。輸出只要更小就顯示成功，沒有保留或告知動畫內容流失。

實測兩幀 WebP 與 APNG 都顯示成功，Pillow 檢查輸出均只剩一幀；WebP 從約 11.6 KB 變成 4,668 bytes，APNG 變成 26,782 bytes。原檔未被改寫，但壓縮結果遺失動畫。

建議：先辨識動畫，預設跳過或原樣複製並說明；只有在有明確動畫編碼流程時才重新壓縮。不能僅用輸出大小判定成功。

### B02 · P1：兩個視窗可輸出同名檔案並覆寫彼此

位置：[BatchCompress/index.tsx:241](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/BatchCompress/index.tsx:241)、[BatchCompress/index.tsx:144](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/BatchCompress/index.tsx:144)。

`uniqueName()` 先檢查不存在，完成編碼後才以 `create: true` 建立並寫入；`claimedNames` 只存在單次批次內。另一個視窗可以在這段時間取得相同名稱，`create: true` 並不表示檔案已存在時拒絕覆寫。

實測使用兩張不同內容、同名 `photo.jpg` 的圖片，在檔名不存在檢查後加入同步屏障，強制兩個視窗同時跨過檢查。兩邊都顯示成功且輸出名稱同為 `photo-compressed.jpg`，目錄卻只有一個結果。此為控制排程的競爭重現，非每次自然操作都會發生；寫入使用真正的 OPFS handle。

建議：在同源視窗間協調檔名分配，例如 Web Locks，並在鎖內重新檢查、建立預留檔案；或為每次執行建立獨立輸出子目錄。仍須界定外部程式同時寫入的處理政策。不要把本機 `Set` 視為跨視窗防覆寫機制。

### B03 · P1：離線快取選錯 codec 變體，PNG／AVIF 無法離線壓縮

位置：[sw/to-cache.ts:83](/C:/Users/david/Documents/Code/Squoosh/src/sw/to-cache.ts:83)、[supports-wasm-threads.ts:16](/C:/Users/david/Documents/Code/Squoosh/src/worker-shared/supports-wasm-threads.ts:16)。

快取在 Service Worker 內偵測執行緒支援，但實際編碼在 Dedicated Worker 內執行，兩者能力不同。實測快取包含單執行緒 AVIF／OxiPNG，實際編碼卻要求多執行緒版本。

重現：使用乾淨瀏覽器環境載入、等待預快取、設為離線後重新載入，再壓縮 JPG／PNG／AVIF。JPG 成功，PNG 與 AVIF 因以下模組未快取而失敗：

- `squoosh_oxipng-d2c66291.js`
- `avif_enc_mt-97a2d466.js`

建議：由真正的處理 Worker 回報能力並讓快取使用同一結果，或快取需要的所有變體；也可在離線時明確回退到已快取變體。只有在所需 codec 快取完成後才顯示「已可離線使用」。

### B04 · P2：合法 AVIF 會被誤判為不支援

位置：[util/index.ts:103](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/util/index.ts:103)。

AVIF 判斷固定比對 16 個 bytes，要求 `ftyp` 大小剛好 32、主要品牌為 `avif`、minor version 為零。這沒有解析相容品牌，也不能接受其他合法 box 大小。

實測把樣本主要品牌改為 `mif1` 並在相容品牌保留 `avif`，瀏覽器可以解碼出 160×120 圖片，但實際 EXE 介面顯示「不支援此檔案格式」。

建議：有界限地解析 ISO BMFF `ftyp` box 與 compatible brands，並把格式識別與實際解碼驗證分開。不要只信副檔名，也不要用單一固定標頭取代容器解析。

### B05 · P2：Worker 啟動失敗會讓整批永久停在「壓縮中」

位置：[worker-bridge/index.ts:28](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/worker-bridge/index.ts:28)、[BatchCompress/index.tsx:378](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/BatchCompress/index.tsx:378)。

bridge 沒有把 Worker 的 `error`／`messageerror` 轉為 RPC 的拒絕結果。若入口腳本無法載入，Comlink 呼叫可以一直沒有回覆；批次又沒有可由使用者觸發的取消機制。現有 10 秒計時器是「呼叫完成後」的閒置回收，不是執行期限。

實測阻擋 `features-worker-*.js` 後，工作仍停在壓縮中且按鈕停用。依程式流程，沒有事件能使這次呼叫結束。

建議：集中管理 Worker 失敗、取消與終止，讓待處理呼叫可 reject；批次使用 `try/finally` 恢復狀態，保留可取消的 controller。執行期限須配合大圖與慢速 codec，不能把正常長任務直接視為失敗。

### B06 · P2：頁面模組載入失敗時永遠停在載入畫面

位置：[lib/omt.ejs:29](/C:/Users/david/Documents/Code/Squoosh/lib/omt.ejs:29)。

自訂 AMD loader 只監聽 preload／script 的 `onload`，沒有 `onerror`，且 Promise 沒有 reject。入口雖然有 `.catch()`，載入 Promise 不拒絕時也不會進入錯誤提示。

實測阻擋 `BatchCompress-*.js`，只顯示「正在載入批次壓縮工具…」，沒有錯誤或重試入口。

建議：為 preload 與 script 提供失敗路徑、清理節點與可重試狀態，並顯示「重新載入」操作。

### B07 · P2：文件中的 `npm run dev` 在 Windows 無法啟動

位置：[package.json:10](/C:/Users/david/Documents/Code/Squoosh/package.json:10)。

實測直接失敗：`'DEV_PORT' is not recognized as an internal or external command`。`DEV_PORT="${DEV_PORT:=5000}"` 與 `$DEV_PORT` 是 Unix shell 語法。

建議：用小型 Node 啟動腳本設定環境變數並啟動 watch／serve，統一 Windows 與其他平台。另須檢查 `lib/simple-ts.js` 的 watch 子程序：首次 tsc 使用 `shell: true`，watch 卻直接 spawn `tsc.cmd`，不能假定修正 npm script 後整個 Windows watch 路徑就已可用。

### B08 · P2：與資料夾同名時，檔名避讓失敗

位置：[BatchCompress/index.tsx:252](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/BatchCompress/index.tsx:252)。

若輸出目錄已有名為 `photo-compressed.jpg` 的資料夾，`getFileHandle()` 會拋出 `TypeMismatchError`。目前只對既有「檔案」繼續編號，資料夾則導致該圖片失敗。

實測建立此同名資料夾後，圖片顯示處理失敗。建議把同名資料夾也當成名稱被占用；權限與其他 I/O 錯誤仍應回報，不能一概吞掉。

### B09 · P2：隨附 Node 伺服器收到不合法 URL 即整個退出

位置：[local-server.js:23](/C:/Users/david/Documents/Code/Squoosh/Squoosh-Batch-Windows-2026-08-10/local-server.js:23)。

`decodeURIComponent()` 在 request callback 中沒有例外處理。實測請求 `/%`，產生 `URIError: URI malformed`，Node 子程序以 exit code 1 結束。

這影響 `.cmd` 啟動版本，不是 C# EXE 的 HTTP 實作。建議捕捉 URI 解析錯誤並回傳 HTTP 400，補上伺服器啟動失敗處理。

## 舊版路徑中的問題

目前首頁只載入 BatchCompress，下列問題不能直接算成目前批次介面的故障；若保留或恢復原版編輯器，應一併處理。

| 問題                         | 證據與位置                                                                                                                                                                                                                                    | 建議                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 換圖時左側舊結果沒有清除     | [Compress/index.tsx:205](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/Compress/index.tsx:205)：迴圈每次 `cleanMerge(state, ...)`，第二圈覆蓋第一圈修改。抽取實際函式測試後左側仍保留舊檔案與 URL，右側才清空。                  | 改從累積的 `newState` 合併。                                                         |
| HQX 放大後裁切使用原尺寸座標 | [resize.ts:109](/C:/Users/david/Documents/Code/Squoosh/src/features/processors/resize/worker/resize.ts:109)：HQX 已先放大 `input`，但裁切仍用 `data.width/height`。替換 WASM 邊界的邏輯測試中，2×4 放大至 8×16 後應裁切 8×8，實際卻裁成 2×2。 | 依目前 `input` 尺寸計算，或先裁切再 HQX；用可辨識區域的圖片做視覺回歸。              |
| 處理設定等價判斷多做工作     | [Compress/index.tsx:261](/C:/Users/david/Documents/Code/Squoosh/src/client/lazy-app/Compress/index.tsx:261)：迴圈比較整體 `a !== b`，沒有比較目前欄位。只有外層物件複製、內部設定相同時仍回傳 false。                                         | 比較 `a[key]` 與 `b[key]`，減少不必要處理。                                          |
| QOI 解碼失敗沒有檢查空指標   | [qoi_dec.cpp:14](/C:/Users/david/Documents/Code/Squoosh/codecs/qoi/dec/qoi_dec.cpp:14)：直接使用解碼結果與 `desc` 建立 ImageData。                                                                                                            | 先檢查結果再讀尺寸，加入損壞輸入測試。本次僅原始碼檢查，未對此原生路徑進行 fuzzing。 |

## Windows 啟動器的程式風險

下列為原始碼確認的設計缺口，未透過本次測試逐一模擬長時間與中斷情境。

- [windows-launcher.cs:211](/C:/Users/david/Documents/Code/Squoosh/windows-launcher.cs:211)：10 分鐘沒有 HTTP 連線就停止伺服器；在瀏覽器開著、正在編碼或操作都命中快取時，也可能沒有新 HTTP 連線。未快取的 codec／資源此後無法取得，與 B03 結合尤其容易出現「頁面還在但功能失敗」。應讓服務生命週期跟應用使用狀態一致，或提供可靠的重新啟動方式。
- [windows-launcher.cs:56](/C:/Users/david/Documents/Code/Squoosh/windows-launcher.cs:56)：5000 埠被占用時直接開瀏覽器，不驗證對方是否為 Squoosh。如果占用者是其他應用，就會開錯服務；若是舊 Squoosh，也沒有版本協調。應先做服務身分／版本檢查；單純換隨機埠會改變 PWA origin，必須連同安裝策略設計。
- [windows-launcher.cs:79](/C:/Users/david/Documents/Code/Squoosh/windows-launcher.cs:79)：只要解壓目錄有 `index.html` 就認為完整。部分檔案被刪掉或解壓中斷時，重新開啟不會修復。應在暫存目錄完整解壓、驗證必要資源後原子切換，最後寫入完成標記。
- [windows-launcher.cs:118](/C:/Users/david/Documents/Code/Squoosh/windows-launcher.cs:118)：每個連線使用阻塞 `ReadLine`，沒有讀取逾時或標頭大小上限。雖然只綁定 loopback，異常本機連線仍可能占用執行緒；可以加入有界限的解析與逾時。

## 優化建議

1. **先縮小批次版本的編碼器集合。** `lib/feature-plugin.js` 會把所有 feature 加入 Worker；`sw/to-cache.ts` 還快取 JXL、WP2 等批次 UI 根本不能選的格式。建置的 `build/c` 共 18,180,072 bytes；以 JXL、WP2、QOI、rotate、imagequant、resize、HQX 檔名前綴計算的候選資產為 9,457,552 bytes，約 52%。這是候選未使用資產的未壓縮大小，不是已實現的 EXE 體積或效能改善。應由批次功能清單同時產生 Worker 與快取清單，而非手動刪檔。
2. **統一 CPU 與記憶體預算。** 批次同時跑兩張，但 [OxiPNG 每個實例都使用全部 logical cores](/C:/Users/david/Documents/Code/Squoosh/src/features/encoders/oxiPNG/worker/oxipngEncode.ts:23)，AVIF 也設定為全部核心。本機回報 24 logical cores，兩個 PNG 任務可各建立 24 執行緒的 pool。建議按圖片像素數、codec 與總核心數分配預算；需量測後再決定並行數。
3. **明確釋放圖像資源。** `builtinDecode()` 使用 ImageBitmap 後未 `close()`，Canvas 與 ImageData 也會有多份像素資料，Comlink 目前複製像素 buffer。建議在適當 `finally` 釋放 bitmap，評估安全的 transferable；先量測大型批次峰值，不把未測量的 GC 壓力直接稱為永久記憶體洩漏。
4. **拆開作業流程與 UI。** 目前 BatchCompress 一個元件同時管檔案辨識、命名、解碼、編碼、I/O 與顯示。可拆成小型的 codec dispatcher、輸出目錄介面及可取消的 batch runner，讓 Preact 只訂閱狀態。保留簡單介面，不需要另建通用任務框架。
5. **處理寫入失敗的收尾。** `writeFile()` 沒有在失敗時 abort writable；磁碟額滿、權限變化與使用者關閉頁面時，需要定義暫存／空檔的清理政策。UI 也缺少整批取消與離開頁面的未完成提示。
6. **移除不必要的外部分析請求。** [initial-app/index.tsx:36](/C:/Users/david/Documents/Code/Squoosh/src/client/initial-app/index.tsx:36) 仍引用原版 Google Analytics ID。瀏覽器測試確實觀察到 `analytics.js` 請求；測試把此第三方請求阻擋。這不等於有圖片上傳，但完全本機工具可以移除這段，或清楚說明遙測政策。
7. **補最小回歸測試與發布驗證。** 優先涵蓋本報告重現案例、靜態格式 smoke test、離線首次使用、Worker 失敗、同名輸出。建置後應啟動瀏覽器驗證，不以 tsc／Rollup 成功代替使用驗證；打包流程應記錄來源版本與資產雜湊，防止 `build/` 過期。
8. **更新依賴要分組做。** 本次 `npm audit` 回報 82 個受影響套件節點：4 critical、28 high、47 moderate、3 low。critical 包括 ejs、loader-utils、minimist、shell-quote。大多屬建置／開發依賴，這不代表 EXE 已有 82 個可利用漏洞；也不能因為都標成 devDependencies 就排除打包進瀏覽器的程式。先處理 lockfile 可安全升級項，再分組驗證 Rollup/PostCSS 等主要更新，不直接執行 `audit fix --force`。npm audit 也不涵蓋預編譯 WASM 內的第三方原生程式。

## 建議處理順序

1. B01 動畫流失、B02 跨視窗防覆寫、B03 離線一致性。
2. B04 格式識別、B05／B06 失敗與取消流程、B07 Windows 開發方式、B08／B09 邊界處理。
3. 啟動器的生命週期、完整解壓與服務辨識；補上端到端回歸測試後重新打包。
4. 收斂批次版本的功能集合、統一資源預算、分組更新依賴。

額外說明：最初測試伺服器漏設 UTF-8 response charset，造成瀏覽器語法錯誤；對齊現有 EXE 的 UTF-8 標頭後正常。這是測試設定問題，不列為 EXE 缺陷。正式頁面目前也沒有 `<meta charset>`，若日後搬到其他靜態伺服器，可加入此宣告提升移植穩健性。
