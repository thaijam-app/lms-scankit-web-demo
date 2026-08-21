import {
  LiveScanner,
  decodeBytes,
  parseBCBP,
  scanContexts,
} from 'lms-scankit-web';

const $ = (selector) => document.querySelector(selector);

const sdkStatus = $('#sdk-status');
const cameraStatus = $('#camera-status');
const cameraMessage = $('#camera-message');
const uploadMessage = $('#upload-message');
const camera = $('#camera');
const cameraFrame = $('#camera-frame');
const placeholder = $('#camera-placeholder');
const contextSelect = $('#context');
const results = $('#results');
const startButton = $('#start-camera');
const stopButton = $('#stop-camera');
const torchButton = $('#torch');
const fileInput = $('#image-file');

let scanner = null;
let torchEnabled = false;

function isWideContext() {
  return contextSelect.value === 'boardingPass' || contextSelect.value === 'code39';
}

function scanRoi() {
  return isWideContext()
    ? { x: 0.03, y: 0.03, width: 0.94, height: 0.94 }
    : { x: 0.1, y: 0.2, width: 0.8, height: 0.55 };
}

function updateScanGuide() {
  cameraFrame.classList.toggle('wide-guide', isWideContext());
}

sdkStatus.textContent = 'SDK 已載入';
sdkStatus.className = 'status status-ready';

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function contextSymbologies() {
  return scanContexts[contextSelect.value].symbologies;
}

function addResult(result) {
  if (results.classList.contains('results-empty')) {
    results.textContent = '';
    results.classList.remove('results-empty');
  }

  const article = document.createElement('article');
  article.className = 'result';

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  const badge = document.createElement('span');
  badge.className = `badge ${result.path === 'hard' ? 'hard' : ''} ${result.path === 'upload' ? 'upload' : ''}`;
  badge.textContent = result.path === 'upload' ? 'IMAGE' : result.path.toUpperCase();
  meta.append(badge, document.createTextNode(`${result.symbology} · ${result.variant} · ${result.timestamp}`));

  const value = document.createElement('p');
  value.className = 'result-value';
  value.textContent = result.rawValue;
  article.append(meta, value);

  if (result.boardingPass) {
    const pass = result.boardingPass;
    const leg = pass.legs?.[0];
    const details = document.createElement('div');
    details.className = 'result-details';
    const fields = [
      ['旅客', pass.passengerName],
      ['航班', leg ? `${leg.carrier}${leg.flightNumber}` : '—'],
      ['航段', leg ? `${leg.origin} → ${leg.destination}` : '—'],
      ['座位', leg?.seat || '—'],
    ];
    for (const [label, fieldValue] of fields) {
      const detail = document.createElement('div');
      detail.className = 'detail';
      const small = document.createElement('small');
      small.textContent = label;
      const span = document.createElement('span');
      span.textContent = fieldValue || '—';
      detail.append(small, span);
      details.append(detail);
    }
    article.append(details);
  }

  results.prepend(article);
}

function showCameraRunning(running) {
  startButton.disabled = running;
  stopButton.disabled = !running;
  torchButton.disabled = !running;
  placeholder.classList.toggle('is-hidden', running);
  cameraStatus.textContent = running ? '掃描中' : '尚未啟動';
}

async function startCamera() {
  setMessage(cameraMessage, '正在請求相機權限…');
  try {
    scanner = new LiveScanner({
      video: camera,
      context: contextSelect.value,
      roi: scanRoi(),
      tickIntervalMs: 120,
      onResult: addResult,
      onError: (error) => setMessage(cameraMessage, `掃描錯誤：${error.message}`, true),
    });
    await scanner.start();
    showCameraRunning(true);
    setMessage(
      cameraMessage,
        isWideContext()
        ? `${contextSelect.value === 'code39' ? 'CODE39' : 'PDF417'} 可歪斜放入大框，不必對準中間線；請保持條碼完整入鏡。`
        : `已啟動 ${contextSelect.value} 情境；請把條碼放入框內。`
    );
  } catch (error) {
    scanner?.stop();
    scanner = null;
    showCameraRunning(false);
    setMessage(cameraMessage, `相機啟動失敗：${error.message}`, true);
  }
}

function stopCamera() {
  scanner?.stop();
  scanner = null;
  torchEnabled = false;
  showCameraRunning(false);
  setMessage(cameraMessage, '相機已停止。');
}

async function toggleTorch() {
  if (!scanner) return;
  torchEnabled = !torchEnabled;
  const supported = await scanner.setTorch(torchEnabled);
  if (!supported) {
    torchEnabled = false;
    setMessage(cameraMessage, '這個瀏覽器或裝置不支援補光燈控制。');
    return;
  }
  torchButton.textContent = torchEnabled ? '關閉補光燈' : '補光燈';
}

async function decodeFile(file, label = file.name) {
  setMessage(uploadMessage, `解碼中：${label}…`);
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hits = await decodeBytes(bytes, contextSymbologies());
    if (hits.length === 0) {
      setMessage(uploadMessage, '沒有解到條碼；可以換另一張圖片或調整情境。', true);
      return;
    }
    for (const hit of hits) {
      addResult({
        ...hit,
        path: 'upload',
        variant: label,
        timestamp: new Date().toISOString(),
        boardingPass: parseBCBP(hit.rawValue) ?? undefined,
      });
    }
    setMessage(uploadMessage, `完成：${hits.length} 個結果。`);
  } catch (error) {
    setMessage(uploadMessage, `圖片解碼失敗：${error.message}`, true);
  }
}

async function decodeFixture(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  await decodeFile(blob, url.split('/').pop());
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
torchButton.addEventListener('click', toggleTorch);
contextSelect.addEventListener('change', updateScanGuide);
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  if (file) void decodeFile(file);
});

for (const button of document.querySelectorAll('[data-fixture]')) {
  button.addEventListener('click', async () => {
    try {
      await decodeFixture(button.dataset.fixture);
    } catch (error) {
      setMessage(uploadMessage, `測試圖載入失敗：${error.message}`, true);
    }
  });
}

$('#clear-results').addEventListener('click', () => {
  results.className = 'results-empty';
  results.textContent = '尚未有結果。';
});

window.addEventListener('beforeunload', stopCamera);
updateScanGuide();
