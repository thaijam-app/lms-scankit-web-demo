/** zxing-wasm 解碼核心包裝 */

import { readBarcodes } from 'zxing-wasm/reader';

import type { DecodedBarcode, ImageDataLike, SymbologyName } from './types.js';

const formatOf: Record<SymbologyName, string> = {
  pdf417: 'PDF417',
  aztec: 'Aztec',
  qr: 'QRCode',
  dataMatrix: 'DataMatrix',
  code128: 'Code128',
  code39: 'Code39',
  ean13: 'EAN-13',
  interleaved2of5: 'ITF'
};

const symbologyOf: Record<string, SymbologyName> = Object.fromEntries(
  (Object.entries(formatOf) as [SymbologyName, string][]).map(([key, value]) => [value, key])
);

function toNativeInput(image: ImageDataLike): ImageData | ImageDataLike {
  if (typeof ImageData !== 'undefined' && !(image instanceof ImageData)) {
    return new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
  }
  return image;
}

/** 解碼像素（瀏覽器路徑；Node 環境視 zxing-wasm 對純物件的支援度，bench 走 decodeBytes） */
export async function decodeImage(
  image: ImageDataLike,
  symbologies: SymbologyName[]
): Promise<DecodedBarcode[]> {
  const results = await readBarcodes(toNativeInput(image) as ImageData, {
    formats: symbologies.map((s) => formatOf[s]) as never,
    tryHarder: true,
    maxNumberOfSymbols: 4
  });
  return results
    .filter((r) => r.isValid && r.text && symbologyOf[r.format])
    .map((r) => ({ symbology: symbologyOf[r.format], rawValue: r.text }));
}

/** 解碼已編碼影像檔（PNG/JPEG bytes）——Node benchmark 與檔案上傳路徑 */
export async function decodeBytes(
  bytes: Uint8Array,
  symbologies: SymbologyName[]
): Promise<DecodedBarcode[]> {
  const results = await readBarcodes(bytes, {
    formats: symbologies.map((s) => formatOf[s]) as never,
    tryHarder: true,
    maxNumberOfSymbols: 4
  });
  return results
    .filter((r) => r.isValid && r.text && symbologyOf[r.format])
    .map((r) => ({ symbology: symbologyOf[r.format], rawValue: r.text }));
}
