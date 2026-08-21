/**
 * Hard Path 攻堅管線——原生版策略的 TS 移植：
 * 1. 前處理變體依序嘗試（JS 單執行緒，改並行無益）
 * 2. 全滅時做四方向透視盲掃，各配 raw＋threshold-faded 兩變體
 */

import { decodeImage } from './decoder.js';
import { blindSweepQuads, variants, warpQuad } from './preprocess.js';
import type { DecodeFn, ImageDataLike, SymbologyName } from './types.js';

export interface HardHit {
  symbology: SymbologyName;
  rawValue: string;
  /** 命中的變體名稱（benchmark 與調校用） */
  variant: string;
}

/** 盲掃階段只跑的精選變體（控制成本）：raw＋自適應二值化 */
const sweepVariants = variants.filter((v) => v.name === 'raw' || v.name === 'otsu');

export interface DecodeHardOptions {
  /**
   * 時間預算（毫秒）：超過即中止剩餘變體，避免在單執行緒上
   * 堵死即時掃描。預設不限（benchmark 用）；LiveScanner 傳 ~800。
   */
  timeBudgetMs?: number;
}

export async function decodeHard(
  image: ImageDataLike,
  symbologies: SymbologyName[],
  decode?: DecodeFn,
  options?: DecodeHardOptions
): Promise<HardHit | null> {
  const decodeFn: DecodeFn = decode ?? ((img) => decodeImage(img, symbologies));
  const deadline = options?.timeBudgetMs !== undefined ? Date.now() + options.timeBudgetMs : Infinity;

  for (const variant of variants) {
    if (Date.now() > deadline) return null;
    const hits = await decodeFn(variant.apply(image));
    const hit = hits.find((h) => symbologies.includes(h.symbology));
    if (hit) {
      return { ...hit, variant: variant.name };
    }
  }

  for (const { name, quad } of blindSweepQuads(image.width, image.height)) {
    if (Date.now() > deadline) return null;
    const flattened = warpQuad(image, quad, image.width, image.height);
    for (const variant of sweepVariants) {
      if (Date.now() > deadline) return null;
      const hits = await decodeFn(variant.apply(flattened));
      const hit = hits.find((h) => symbologies.includes(h.symbology));
      if (hit) {
        return { ...hit, variant: `${variant.name}+sweep-${name}` };
      }
    }
  }

  return null;
}
