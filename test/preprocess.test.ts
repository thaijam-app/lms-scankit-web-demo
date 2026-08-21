import assert from 'node:assert/strict';
import { test } from 'node:test';

import { grayContrast, thresholdBinarize, warpQuad } from '../src/preprocess.js';
import type { ImageDataLike } from '../src/types.js';

function solid(width: number, height: number, value: number): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

test('threshold：門檻上下正確二值化', () => {
  const light = thresholdBinarize(solid(2, 2, 200), 0.72); // 200/255 ≈ 0.78 ≥ 0.72 → 白
  assert.equal(light.data[0], 255);
  const dark = thresholdBinarize(solid(2, 2, 170), 0.72); // 170/255 ≈ 0.67 < 0.72 → 黑
  assert.equal(dark.data[0], 0);
});

test('grayContrast：以 128 為軸拉伸', () => {
  const out = grayContrast(solid(1, 1, 160), 2.0); // (160-128)*2+128 = 192
  assert.equal(out.data[0], 192);
  const clipped = grayContrast(solid(1, 1, 250), 2.2); // 超界 → clamp 255
  assert.equal(clipped.data[0], 255);
});

test('warpQuad：恆等四邊形＝原圖', () => {
  const image = solid(4, 4, 128);
  // 左上角挖一個黑點以驗證位置不動
  image.data[0] = image.data[1] = image.data[2] = 0;
  const identity = warpQuad(
    image,
    {
      topLeft: [0, 0],
      topRight: [3, 0],
      bottomRight: [3, 3],
      bottomLeft: [0, 3]
    },
    4,
    4
  );
  assert.equal(identity.data[0], 0); // 黑點仍在左上
  assert.equal(identity.data[(3 * 4 + 3) * 4], 128); // 右下仍是灰
});

test('warpQuad：界外取樣補白', () => {
  const image = solid(4, 4, 0);
  const out = warpQuad(
    image,
    {
      topLeft: [-10, -10],
      topRight: [-6, -10],
      bottomRight: [-6, -6],
      bottomLeft: [-10, -6]
    },
    2,
    2
  );
  assert.equal(out.data[0], 255);
});
