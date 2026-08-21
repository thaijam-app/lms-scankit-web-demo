/**
 * 前處理變體——原生 Hard Path 策略層的 TS 移植。
 * 所有操作純 CPU 像素運算（無外部依賴），輸入輸出皆為 RGBA ImageDataLike。
 */

import type { ImageDataLike } from './types.js';

function allocLike(image: ImageDataLike, width = image.width, height = image.height): ImageDataLike {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

/** 灰階＋線性對比拉伸（contrast 以 128 為軸；brightness 0–1 映射為 0–255 偏移） */
export function grayContrast(image: ImageDataLike, contrast: number, brightness = 0): ImageDataLike {
  const out = allocLike(image);
  const src = image.data;
  const dst = out.data;
  const offset = brightness * 255;
  for (let i = 0; i < src.length; i += 4) {
    const gray = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    const value = (gray - 128) * contrast + 128 + offset;
    dst[i] = dst[i + 1] = dst[i + 2] = value;
    dst[i + 3] = 255;
  }
  return out;
}

/** Gamma 調整（假設輸入已是灰階或不在乎彩度） */
export function gammaAdjust(image: ImageDataLike, power: number): ImageDataLike {
  const out = allocLike(image);
  const src = image.data;
  const dst = out.data;
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    table[v] = Math.pow(v / 255, power) * 255;
  }
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = table[src[i]];
    dst[i + 1] = table[src[i + 1]];
    dst[i + 2] = table[src[i + 2]];
    dst[i + 3] = 255;
  }
  return out;
}

/** 灰階二值化：亮度 >= t(0–1) → 白，否則黑 */
export function thresholdBinarize(image: ImageDataLike, t: number): ImageDataLike {
  const out = allocLike(image);
  const src = image.data;
  const dst = out.data;
  const cut = t * 255;
  for (let i = 0; i < src.length; i += 4) {
    const gray = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    const value = gray >= cut ? 255 : 0;
    dst[i] = dst[i + 1] = dst[i + 2] = value;
    dst[i + 3] = 255;
  }
  return out;
}

/** 3×3 銳化卷積（unsharp 風格核）；邊緣像素原樣保留 */
export function sharpen(image: ImageDataLike): ImageDataLike {
  const { width, height } = image;
  const out = allocLike(image);
  const src = image.data;
  const dst = out.data;
  dst.set(src);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c += 1) {
        const value =
          5 * src[i + c] -
          src[i - 4 + c] -
          src[i + 4 + c] -
          src[i - width * 4 + c] -
          src[i + width * 4 + c];
        dst[i + c] = value;
      }
      dst[i + 3] = 255;
    }
  }
  return out;
}

function grayHistogram(image: ImageDataLike): { histogram: Uint32Array; grays: Uint8ClampedArray } {
  const { data } = image;
  const pixelCount = data.length / 4;
  const grays = new Uint8ClampedArray(pixelCount);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const gray = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    grays[p] = gray;
    histogram[gray] += 1;
  }
  return { histogram, grays };
}

function fromGrays(grays: Uint8ClampedArray, width: number, height: number, map: (g: number) => number): ImageDataLike {
  const out = allocLike({ data: new Uint8ClampedArray(0), width, height });
  const dst = out.data;
  for (let p = 0; p < grays.length; p += 1) {
    const value = map(grays[p]);
    const i = p * 4;
    dst[i] = dst[i + 1] = dst[i + 2] = value;
    dst[i + 3] = 255;
  }
  return out;
}

/**
 * 百分位直方圖拉伸：p2 → 黑、p98 → 白。
 * 褪色票的殺手鐧——把塌掉的動態範圍整段拉回，等效 Vision 的內部正規化。
 */
export function histogramStretch(image: ImageDataLike, lowPct = 0.02, highPct = 0.98): ImageDataLike {
  const { histogram, grays } = grayHistogram(image);
  const total = grays.length;
  let low = 0;
  let high = 255;
  let cumulative = 0;
  for (let v = 0; v < 256; v += 1) {
    cumulative += histogram[v];
    if (cumulative >= total * lowPct) {
      low = v;
      break;
    }
  }
  cumulative = 0;
  for (let v = 255; v >= 0; v -= 1) {
    cumulative += histogram[v];
    if (cumulative >= total * (1 - highPct)) {
      high = v;
      break;
    }
  }
  const range = Math.max(1, high - low);
  return fromGrays(grays, image.width, image.height, (g) => ((g - low) * 255) / range);
}

/** Otsu 自動門檻二值化：對任意褪色程度自動找最佳分割點 */
export function otsuBinarize(image: ImageDataLike): ImageDataLike {
  const { histogram, grays } = grayHistogram(image);
  const total = grays.length;
  let sum = 0;
  for (let v = 0; v < 256; v += 1) sum += v * histogram[v];

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let v = 0; v < 256; v += 1) {
    weightBackground += histogram[v];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;
    sumBackground += v * histogram[v];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const betweenVariance =
      weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (betweenVariance > bestVariance) {
      bestVariance = betweenVariance;
      threshold = v;
    }
  }
  return fromGrays(grays, image.width, image.height, (g) => (g > threshold ? 255 : 0));
}

/** 前處理變體（順序即優先序，與原生版對齊；先便宜後昂貴） */
export const variants: { name: string; apply: (image: ImageDataLike) => ImageDataLike }[] = [
  { name: 'raw', apply: (image) => image },
  { name: 'stretch', apply: (image) => histogramStretch(image) },
  { name: 'otsu', apply: (image) => otsuBinarize(image) },
  { name: 'contrast+sharpen', apply: (image) => sharpen(grayContrast(image, 1.5)) },
  { name: 'highContrast+gamma', apply: (image) => gammaAdjust(grayContrast(image, 2.2), 0.6) },
  { name: 'threshold-dark', apply: (image) => thresholdBinarize(image, 0.45) },
  { name: 'threshold-faded', apply: (image) => thresholdBinarize(image, 0.72) }
];

// MARK: 透視盲掃

export interface Quad {
  /** 影像像素座標，左上原點（canvas 慣例） */
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
}

/**
 * 單位正方形 → 四邊形的射影變換（homography）反向取樣：
 * 對每個輸出像素，求其在來源四邊形內的位置並雙線性取樣。
 * 對應原生版的 CIPerspectiveCorrection。
 */
export function warpQuad(image: ImageDataLike, quad: Quad, outWidth: number, outHeight: number): ImageDataLike {
  const [x0, y0] = quad.topLeft;
  const [x1, y1] = quad.topRight;
  const [x2, y2] = quad.bottomRight;
  const [x3, y3] = quad.bottomLeft;

  // 射影映射係數（單位正方形 (u,v) → 四邊形）
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  let g = 0;
  let h = 0;
  const denominator = dx1 * dy2 - dx2 * dy1;
  if ((sx !== 0 || sy !== 0) && denominator !== 0) {
    g = (sx * dy2 - dx2 * sy) / denominator;
    h = (dx1 * sy - sx * dy1) / denominator;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  const out = allocLike(image, outWidth, outHeight);
  const src = image.data;
  const dst = out.data;
  const { width, height } = image;

  for (let oy = 0; oy < outHeight; oy += 1) {
    const v = oy / (outHeight - 1 || 1);
    for (let ox = 0; ox < outWidth; ox += 1) {
      const u = ox / (outWidth - 1 || 1);
      const w = g * u + h * v + 1;
      const sxF = (a * u + b * v + c) / w;
      const syF = (d * u + e * v + f) / w;

      const di = (oy * outWidth + ox) * 4;
      if (sxF < 0 || syF < 0 || sxF > width - 1 || syF > height - 1) {
        dst[di] = dst[di + 1] = dst[di + 2] = 255; // 界外補白（條碼背景）
        dst[di + 3] = 255;
        continue;
      }
      // 雙線性取樣
      const xi = Math.floor(sxF);
      const yi = Math.floor(syF);
      const fx = sxF - xi;
      const fy = syF - yi;
      const x2i = Math.min(xi + 1, width - 1);
      const y2i = Math.min(yi + 1, height - 1);
      const i00 = (yi * width + xi) * 4;
      const i10 = (yi * width + x2i) * 4;
      const i01 = (y2i * width + xi) * 4;
      const i11 = (y2i * width + x2i) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        const top = src[i00 + ch] * (1 - fx) + src[i10 + ch] * fx;
        const bottom = src[i01 + ch] * (1 - fx) + src[i11 + ch] * fx;
        dst[di + ch] = top * (1 - fy) + bottom * fy;
      }
      dst[di + 3] = 255;
    }
  }
  return out;
}

/**
 * 四方向盲掃梯形（m=0.45）——與原生版同一套戰法：
 * 假設內容佔據某方向的透視梯形，部分反攤平即可把殘餘角度
 * 拉回解碼器自身的容忍區間。座標為左上原點。
 */
export function blindSweepQuads(width: number, height: number): { name: string; quad: Quad }[] {
  // 單檔強度 m=0.45：實測第二檔（0.62）對 zxing 核心無增益，
  // >55° 的極限角度是原生引擎（Vision）的守備範圍
  const strengths = [0.45];
  const results: { name: string; quad: Quad }[] = [];

  for (const m of strengths) {
    const shrinkX = width * m * 0.35;
    const shrinkY = height * m * 0.35;
    const insetY = height * m / 2;
    const insetX = width * m / 2;
    const tag = m === strengths[0] ? '' : `-${Math.round(m * 100)}`;

    results.push(
      {
        name: `right${tag}`,
        quad: {
          topLeft: [0, 0],
          topRight: [width - shrinkX, insetY],
          bottomRight: [width - shrinkX, height - insetY],
          bottomLeft: [0, height]
        }
      },
      {
        name: `left${tag}`,
        quad: {
          topLeft: [shrinkX, insetY],
          topRight: [width, 0],
          bottomRight: [width, height],
          bottomLeft: [shrinkX, height - insetY]
        }
      },
      {
        name: `top${tag}`,
        quad: {
          topLeft: [insetX, shrinkY],
          topRight: [width - insetX, shrinkY],
          bottomRight: [width, height],
          bottomLeft: [0, height]
        }
      },
      {
        name: `bottom${tag}`,
        quad: {
          topLeft: [0, 0],
          topRight: [width, 0],
          bottomRight: [width - insetX, height - shrinkY],
          bottomLeft: [insetX, height - shrinkY]
        }
      }
    );
  }
  return results;
}
