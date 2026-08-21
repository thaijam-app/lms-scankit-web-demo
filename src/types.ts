/** 與原生 LMSScanKit / Capacitor plugin 對齊的型別定義 */

export type SymbologyName =
  | 'pdf417'
  | 'aztec'
  | 'qr'
  | 'dataMatrix'
  | 'code128'
  | 'code39'
  | 'ean13'
  | 'interleaved2of5';

export type ScanContextName = 'lounge' | 'boardingPass' | 'membership' | 'baggage' | 'code39';

/** 解碼命中的管線層：fast = 逐幀直解、hard = 前處理攻堅 */
export type ScanPathName = 'fast' | 'hard';

/** 跨環境的像素容器（瀏覽器 ImageData 與 Node 皆可） */
export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface DecodedBarcode {
  symbology: SymbologyName;
  rawValue: string;
}

/** 解碼函式抽象：pipeline 透過它解像素，方便測試與 Node/browser 分流 */
export type DecodeFn = (image: ImageDataLike) => Promise<DecodedBarcode[]>;
