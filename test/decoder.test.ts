import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodeBytes } from '../src/decoder.js';

// dist/test/ → 專案根目錄的 fixtures/
const fixture = (name: string): string =>
  fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));

const realBCBP =
  'M1BKKAPP/AAAA         TESTAA5 TPEBKKBR 0067 145C010A0100 377>8320 W5209BBR' +
  '                                        2A69525012345670 BR NH 3123000002          Y*30600000K09  NHG';

test('zxing-wasm 解碼真實密度 PDF417 fixture', async () => {
  const bytes = new Uint8Array(await readFile(fixture('bp01-pdf417.png')));
  const hits = await decodeBytes(bytes, ['pdf417']);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].symbology, 'pdf417');
  assert.equal(hits[0].rawValue, realBCBP);
});

test('zxing-wasm 解碼 QR fixture 並過濾 symbology', async () => {
  const bytes = new Uint8Array(await readFile(fixture('label01-qr.png')));
  const hits = await decodeBytes(bytes, ['qr']);
  assert.equal(hits[0]?.rawValue, 'PMC11633BR');

  // 只開 pdf417 時，QR 不得回報
  const filtered = await decodeBytes(bytes, ['pdf417']);
  assert.equal(filtered.length, 0);
});
