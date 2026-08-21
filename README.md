# lms-scankit-web

航空條碼掃描 Web SDK——**zxing-js 的直接替代品**。zxing-wasm（zxing-cpp）解碼核心＋原生 LMSScanKit 驗證過的策略層：ROI 裁切、自適應前處理變體、透視盲掃、IATA BCBP 解析。

純瀏覽器可用（含 iPad Safari），無原生依賴。要原生等級的掃描品質（極限角度、12MP Hard Path、自動變焦），用殼 App＋`lms-scanner-plugin`。

## 使用

```js
import { LiveScanner } from 'lms-scankit-web';

const scanner = new LiveScanner({
  video: document.querySelector('video'),
  context: 'lounge',                        // lounge / boardingPass / membership / baggage
  roi: { x: 0.1, y: 0.25, width: 0.8, height: 0.5 },  // 掃描框（可選）
  onResult: (r) => {
    console.log(r.symbology, r.rawValue, r.path, r.variant);
    if (r.boardingPass) console.log(r.boardingPass.passengerName, r.boardingPass.legs[0].seat);
  }
});
await scanner.start();
// scanner.stop() / scanner.setTorch(true)
```

單張影像（檔案上傳、拍照）：

```js
import { decodeBytes, decodeHard, parseBCBP } from 'lms-scankit-web';
const hits = await decodeBytes(pngOrJpegBytes, ['pdf417', 'aztec', 'qr']);
```

## 管線

1. **Fast**：每 tick 對 ROI 直解（~8fps）
2. **變體輪替**：連續失敗 0.4s 後，每 tick 輪替一個前處理變體（直方圖拉伸／Otsu 自動門檻／對比＋銳化／gamma／固定門檻 ×2）
3. **Hard Path**：久攻不下（1.2s）時全變體＋四方向透視盲掃

## Benchmark（與原生版同一批 136 張合成劣化樣本）

```
先在 LMSScanKit 目錄：swift run -c release scanbench exportbench ../bench-images
再於本目錄：npm run bench -- ../bench-images
```

| | baseline（裸 zxing-wasm≈zxing-js 上限） | 本 SDK Hard Path |
|---|---|---|
| 總分 | 64% | **75%** |
| 褪色（fade） | 8/12 | **12/12** |
| 傾斜 ≤45° | 12/12 | 12/12 |
| 傾斜 >55° | 4/12 | 4/12（Web 天花板，原生引擎守備） |

原生版同矩陣為 baseline 80% / Hard Path 93%——Web 版的定位是「瀏覽器裡能拿到的最好」，不是原生替代。

## 開發

```bash
npm test    # 型別檢查＋單元測試（BCBP／前處理／zxing 解碼 fixtures）
npm run bench -- <bench-images 路徑>
```

## Browser Demo

啟動純 HTML/JS 測試頁：

```bash
npm run build
python3 -m http.server 4173
```

開啟 <http://localhost:4173/>。頁面支援瀏覽器相機掃描、圖片上傳，以及內建 PDF417/QR fixture。

推送到 `main` 後，`.github/workflows/pages.yml` 會自動建置並部署 GitHub Pages。若要使用自己的網域，請在 repo 根目錄新增 `CNAME`（內容只放完整網域名稱），再於 DNS 供應商新增 GitHub Pages 要求的記錄。
