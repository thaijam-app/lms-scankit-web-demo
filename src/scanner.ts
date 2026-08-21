/**
 * 瀏覽器即時掃描器——zxing-js 的直接替代品。
 *
 * ```js
 * const scanner = new LiveScanner({
 *   video: document.querySelector('video'),
 *   context: 'lounge',
 *   onResult: (r) => console.log(r.rawValue, r.boardingPass)
 * });
 * await scanner.start();
 * ```
 */

import { parseBCBP, type BoardingPassData } from './bcbp.js';
import { scanContexts } from './context.js';
import { decodeImage } from './decoder.js';
import { decodeHard } from './pipeline.js';
import { variants } from './preprocess.js';
import type { ImageDataLike, ScanContextName, ScanPathName, SymbologyName } from './types.js';

export interface WebScanResult {
  symbology: SymbologyName;
  rawValue: string;
  path: ScanPathName;
  /** 命中變體（fast 路徑為 'raw'） */
  variant: string;
  timestamp: string;
  boardingPass?: BoardingPassData;
}

export interface LiveScannerOptions {
  video: HTMLVideoElement;
  context?: ScanContextName;
  /** 掃描框（相對 video 內容的 0–1 正規化座標）；預設全幅 */
  roi?: { x: number; y: number; width: number; height: number };
  onResult: (result: WebScanResult) => void;
  onError?: (error: Error) => void;
  /** 逐幀解碼間隔（毫秒），預設 120 ≈ 8fps */
  tickIntervalMs?: number;
  /**
   * 啟動時嘗試設定的相機變焦倍率（預設 1.5，設 0 停用）。
   * 密 PDF417 的解碼上限由「每模組像素數」決定，拉近是最有效的一招；
   * iOS Safari 17+／Android Chrome 支援，不支援的裝置靜默略過。
   */
  initialZoom?: number;
}

export class LiveScanner {
  private readonly options: LiveScannerOptions;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private busy = false;
  private stopped = true;
  private variantRotation = 0;
  private lastHitAt = 0;
  private lastHardPathAt = 0;
  private readonly recentValues = new Map<string, number>();

  constructor(options: LiveScannerOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.stream) return; // 已在掃描中，重複呼叫安全
    this.stopped = false;
    const { video } = this.options;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        // 要 4K，裝置給不了會自動降——密 PDF417 的成敗就在像素數
        width: { ideal: 3840 },
        height: { ideal: 2160 }
      },
      audio: false
    });
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true'); // iOS Safari 必需
    await video.play();

    const initialZoom = this.options.initialZoom ?? 1.5;
    if (initialZoom > 0) {
      void this.setZoom(initialZoom); // 不支援 zoom 的裝置靜默略過
    }

    // 從現在起算「未命中」時間，避免啟動瞬間誤觸攻堅
    this.lastHitAt = Date.now();

    const interval = this.options.tickIntervalMs ?? 120;
    this.timer = setInterval(() => void this.tick(), interval);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.options.video.srcObject = null;
  }

  /** 補光燈（多數 iOS Safari 不支援；回傳是否成功） */
  async setTorch(enabled: boolean): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  /** 相機光學/感光變焦（支援度依裝置；回傳是否成功） */
  async setZoom(factor: number): Promise<boolean> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return false;
    const capabilities = track.getCapabilities() as { zoom?: { min: number; max: number } };
    if (!capabilities.zoom) return false;
    const target = Math.min(Math.max(factor, capabilities.zoom.min), capabilities.zoom.max);
    try {
      await track.applyConstraints({ advanced: [{ zoom: target } as unknown as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }

  private grabROI(maxWidth = 1280): ImageDataLike | null {
    const { video, roi } = this.options;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const sx = roi ? roi.x * vw : 0;
    const sy = roi ? roi.y * vh : 0;
    const sw = roi ? roi.width * vw : vw;
    const sh = roi ? roi.height * vh : vh;

    // fast tick 用 1280 上限省 CPU；Hard Path 傳大值拿全解析度——
    // 密 PDF417 的成敗就在每模組像素數，攻堅時一個像素都不能丟
    const scale = Math.min(1, maxWidth / sw);
    const dw = Math.round(sw * scale);
    const dh = Math.round(sh * scale);

    if (!this.canvas || this.canvas.width !== dw || this.canvas.height !== dh) {
      this.canvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(dw, dh)
          : Object.assign(document.createElement('canvas'), { width: dw, height: dh });
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) return null;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    return ctx.getImageData(0, 0, dw, dh);
  }

  /**
   * 廉價的「畫面有東西」偵測：灰階標準差。條碼是高對比結構，
   * 空櫃檯/均勻背景的標準差很低——只用來閘控攻堅，避免待機空轉。
   * 對應原生版的 Vision 定位信號（zxing 失敗時不提供任何定位資訊）。
   */
  private hasStructure(image: ImageDataLike): boolean {
    const { data } = image;
    const stride = 64; // 每 16 個像素取 1 個樣本
    let count = 0;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < data.length; i += stride) {
      const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += gray;
      sumSquares += gray * gray;
      count += 1;
    }
    if (count === 0) return false;
    const mean = sum / count;
    const variance = sumSquares / count - mean * mean;
    // 門檻刻意設低（10）：只擋真正的空白畫面。重褪色票的標準差
    // 可能只有 10–15，設高會把 Hard Path 的主要目標誤判成空景。
    return Math.sqrt(Math.max(0, variance)) > 10;
  }

  private emit(symbology: SymbologyName, rawValue: string, path: ScanPathName, variant: string): void {
    if (this.stopped) return;
    const context = scanContexts[this.options.context ?? 'lounge'];
    const now = Date.now();
    const lastSeen = this.recentValues.get(rawValue);
    if (lastSeen !== undefined && now - lastSeen < context.dedupeIntervalMs) {
      this.lastHitAt = now; // 同一張票還在鏡頭前，不觸發 Hard Path
      return;
    }
    this.recentValues.set(rawValue, now);
    if (this.recentValues.size > 64) {
      for (const [value, at] of this.recentValues) {
        if (now - at > context.dedupeIntervalMs) this.recentValues.delete(value);
      }
    }
    this.lastHitAt = now;

    const boardingPass = parseBCBP(rawValue) ?? undefined;
    this.options.onResult({
      symbology,
      rawValue,
      path,
      variant,
      timestamp: new Date(now).toISOString(),
      boardingPass
    });
  }

  private async tick(): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      const context = scanContexts[this.options.context ?? 'lounge'];
      const image = this.grabROI();
      if (!image) return;

      // Fast 路徑：raw 直解
      let hits = await decodeImage(image, context.symbologies);
      if (hits.length > 0) {
        for (const hit of hits) this.emit(hit.symbology, hit.rawValue, 'fast', 'raw');
        return;
      }

      const now = Date.now();
      const sinceHit = now - this.lastHitAt;

      // 攻堅只在畫面有結構時進行：空櫃檯待機不空轉 CPU
      if (!this.hasStructure(image)) return;

      // 輕量攻堅：每個 tick 輪替一個前處理變體（攤平 CPU 負載）
      if (sinceHit > 400) {
        this.variantRotation = (this.variantRotation + 1) % (variants.length - 1);
        const variant = variants[this.variantRotation + 1]; // 跳過 raw
        hits = await decodeImage(variant.apply(image), context.symbologies);
        if (hits.length > 0) {
          for (const hit of hits) this.emit(hit.symbology, hit.rawValue, 'fast', variant.name);
          return;
        }
      }

      // Hard Path：久攻不下時全變體＋透視盲掃——重抓「全解析度」ROI 攻堅
      if (sinceHit > context.hardPathTimeoutMs && now - this.lastHardPathAt > context.hardPathCooldownMs) {
        this.lastHardPathAt = now;
        const fullRes = this.grabROI(4096) ?? image;
        const hit = await decodeHard(fullRes, context.symbologies);
        if (hit) this.emit(hit.symbology, hit.rawValue, 'hard', hit.variant);
      }
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.busy = false;
    }
  }
}
