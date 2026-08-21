import type { ScanContextName, SymbologyName } from './types.js';

/** 掃描情境：限縮 symbology 集合是最便宜的提速手段（與原生版一致） */
export interface ScanContext {
  symbologies: SymbologyName[];
  /** 同碼在此毫秒數內不重複回報 */
  dedupeIntervalMs: number;
  /** 連續失敗達此毫秒數後，升級 Hard Path（全變體＋透視盲掃） */
  hardPathTimeoutMs: number;
  /** 兩次 Hard Path 的最小間隔（控制 CPU） */
  hardPathCooldownMs: number;
}

const defaults = {
  dedupeIntervalMs: 5000,
  hardPathTimeoutMs: 1200,
  hardPathCooldownMs: 2000
};

export const scanContexts: Record<ScanContextName, ScanContext> = {
  lounge: {
    ...defaults,
    symbologies: ['pdf417', 'aztec', 'qr', 'dataMatrix', 'code128', 'code39', 'ean13']
  },
  boardingPass: {
    ...defaults,
    symbologies: ['pdf417', 'aztec', 'qr', 'dataMatrix']
  },
  membership: {
    ...defaults,
    symbologies: ['qr', 'aztec', 'code128', 'code39', 'ean13']
  },
  baggage: {
    ...defaults,
    symbologies: ['code128', 'interleaved2of5']
  }
};
