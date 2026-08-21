/**
 * Node benchmark：吃 scanbench exportbench 產出的矩陣樣本，
 * 與原生版同一批影像、同一張矩陣比數字。
 *
 * 用法：npm run bench [-- <bench-images 路徑>]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

import { decodeBytes, decodeImage } from '../src/decoder.js';
import { decodeHard } from '../src/pipeline.js';
import type { DecodedBarcode, ImageDataLike, SymbologyName } from '../src/types.js';

interface ManifestEntry {
  file: string;
  symbology: SymbologyName;
  payload: string;
  scenario: string;
  severity: number;
}

const dir = process.argv[2] ?? path.resolve(process.cwd(), '../bench-images');

const manifest: ManifestEntry[] = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));

function pngToImageData(buffer: Buffer): ImageDataLike {
  const png = PNG.sync.read(buffer);
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
    width: png.width,
    height: png.height
  };
}

// zxing-wasm 在 Node 對純物件 ImageData 的支援：先探測一次，
// 不行就退回「重編碼 PNG → decodeBytes」的慢路徑。
let plainObjectWorks: boolean | null = null;

async function nodeDecode(image: ImageDataLike, symbologies: SymbologyName[]): Promise<DecodedBarcode[]> {
  if (plainObjectWorks !== false) {
    try {
      const result = await decodeImage(image, symbologies);
      plainObjectWorks = true;
      return result;
    } catch {
      plainObjectWorks = false;
    }
  }
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return decodeBytes(new Uint8Array(PNG.sync.write(png)), symbologies);
}

// 依 scenario 分組統計
const rows = new Map<string, { base: number; hard: number; total: number }>();
let baseTotal = 0;
let hardTotal = 0;
const startedAt = Date.now();

for (const entry of manifest) {
  const buffer = await readFile(path.join(dir, entry.file));
  const symbologies: SymbologyName[] = [entry.symbology];

  const baseHits = await decodeBytes(new Uint8Array(buffer), symbologies);
  const baseOK = baseHits.some((h) => h.rawValue === entry.payload);

  const image = pngToImageData(buffer);
  const hard = await decodeHard(image, symbologies, (img) => nodeDecode(img, symbologies));
  const hardOK = hard?.rawValue === entry.payload;

  const key = entry.scenario;
  const row = rows.get(key) ?? { base: 0, hard: 0, total: 0 };
  row.total += 1;
  if (baseOK) {
    row.base += 1;
    baseTotal += 1;
  }
  if (hardOK) {
    row.hard += 1;
    hardTotal += 1;
  }
  rows.set(key, row);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`lms-scankit-web benchmark（zxing-wasm 核心）— ${manifest.length} 樣本，${elapsed}s\n`);
console.log('scenario   | baseline | hard path');
console.log('-----------|----------|----------');
for (const [scenario, row] of rows) {
  const fmt = (n: number): string => `${n}/${row.total}`.padEnd(8);
  console.log(`${scenario.padEnd(10)} | ${fmt(row.base)} | ${fmt(row.hard)}`);
}
const pct = (n: number): string => `${((n / manifest.length) * 100).toFixed(0)}%`;
console.log(`\n總計：baseline ${baseTotal} (${pct(baseTotal)})、hard path ${hardTotal} (${pct(hardTotal)})`);
