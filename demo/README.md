# LMSScanKit-Web 測試頁

這是一個不依賴框架的純 HTML/JS 測試頁，直接匯入 `../dist/src/index.js`。

在 `lms-scankit-web` 目錄執行：

```bash
npm run build
python3 -m http.server 4173
```

再開啟 <http://localhost:4173/demo/>。相機測試需要 localhost 或 HTTPS；圖片測試可以直接點內建 fixture。
