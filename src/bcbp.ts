/**
 * IATA BCBP（Resolution 792）固定寬度欄位解析——原生 LMSScanKit 解析器的 TS 移植。
 * 寬容策略：必填欄位齊全即接受；conditional 區允許截斷（規格明文允許），有多少解多少。
 */

export interface BoardingPassLeg {
  pnr: string;
  origin: string;
  destination: string;
  carrier: string;
  flightNumber: string;
  julianDate: number;
  compartment: string;
  seat: string;
  checkInSequence: string;
  passengerStatus: string;
  marketingCarrier?: string;
  frequentFlyerAirline?: string;
  /** 常客號——貴賓室資格判斷的關鍵欄位 */
  frequentFlyerNumber?: string;
  fastTrack?: boolean;
  selecteeIndicator?: string;
  freeBaggageAllowance?: string;
}

export interface BoardingPassData {
  passengerName: string;
  lastName: string;
  firstName?: string;
  isElectronicTicket: boolean;
  legs: BoardingPassLeg[];
  bcbpVersion?: string;
  issuerAirline?: string;
  issueDateCode?: string;
  baggageTag?: string;
}

// 標頭：格式碼 1 + 航段數 1 + 姓名 20 + 電子票識別 1
const HEADER_LENGTH = 23;
// 每航段必填區：PNR 7 + 出發 3 + 到達 3 + 航司 3 + 航班 5
//             + 日期 3 + 艙等 1 + 座位 4 + 序號 5 + 狀態 1 + 條件區長度 2
const LEG_MANDATORY_LENGTH = 37;

/** 順序讀取器：欄位不足時回 undefined，天然容忍截斷 */
class Cursor {
  constructor(
    private readonly text: string,
    public index: number,
    private readonly end: number
  ) {}

  read(length: number): string | undefined {
    if (this.index + length > this.end) {
      this.index = this.end;
      return undefined;
    }
    const value = this.text.slice(this.index, this.index + length);
    this.index += length;
    return value;
  }

  readTrimmed(length: number): string | undefined {
    const value = this.read(length)?.trim();
    return value ? value : undefined;
  }

  readHexSize(): number | undefined {
    const value = this.read(2);
    if (value === undefined) return undefined;
    const parsed = parseInt(value, 16);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  skip(length: number): void {
    this.index = Math.min(this.index + length, this.end);
  }
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped === '' ? value : stripped;
}

interface ConditionalUnique {
  version?: string;
  issuerAirline?: string;
  issueDateCode?: string;
  baggageTag?: string;
}

interface ConditionalRepeated {
  marketingCarrier?: string;
  frequentFlyerAirline?: string;
  frequentFlyerNumber?: string;
  fastTrack?: boolean;
  selecteeIndicator?: string;
  freeBaggageAllowance?: string;
}

/** 唯一欄位段（僅第一航段）：">" + 版本 1 + 段長 2(hex) + 內容 */
function parseUniqueSection(cursor: Cursor, text: string, condEnd: number): ConditionalUnique {
  const unique: ConditionalUnique = {};
  if (cursor.read(1) !== '>') return unique;
  unique.version = cursor.readTrimmed(1);
  const sectionSize = cursor.readHexSize();
  if (sectionSize === undefined) return unique;

  const section = new Cursor(text, cursor.index, Math.min(cursor.index + sectionSize, condEnd));
  cursor.skip(sectionSize);

  section.skip(1); //                                旅客描述
  section.skip(1); //                                報到來源
  section.skip(1); //                                登機證核發來源
  unique.issueDateCode = section.readTrimmed(4); //  核發日期（年末碼＋Julian）
  section.skip(1); //                                證件類型
  unique.issuerAirline = section.readTrimmed(3); //  核發航司
  unique.baggageTag = section.readTrimmed(13); //    行李牌
  return unique;
}

/** 重複欄位段（每航段）：段長 2(hex) + 內容 */
function parseRepeatedSection(cursor: Cursor, text: string, condEnd: number): ConditionalRepeated {
  const repeated: ConditionalRepeated = {};
  const sectionSize = cursor.readHexSize();
  if (sectionSize === undefined || sectionSize <= 0) return repeated;

  const section = new Cursor(text, cursor.index, Math.min(cursor.index + sectionSize, condEnd));
  cursor.skip(sectionSize);

  section.skip(3); //                                           航司數字代碼
  section.skip(10); //                                          票號序號
  repeated.selecteeIndicator = section.readTrimmed(1);
  section.skip(1); //                                           國際證件查驗
  repeated.marketingCarrier = section.readTrimmed(3);
  repeated.frequentFlyerAirline = section.readTrimmed(3);
  repeated.frequentFlyerNumber = section.readTrimmed(16);
  section.skip(1); //                                           ID/AD identifier
  repeated.freeBaggageAllowance = section.readTrimmed(3);
  const fastTrack = section.readTrimmed(1);
  if (fastTrack !== undefined) repeated.fastTrack = fastTrack === 'Y';
  return repeated;
}

export function parseBCBP(raw: string): BoardingPassData | null {
  if (raw.length < HEADER_LENGTH + LEG_MANDATORY_LENGTH) return null;
  if (raw[0] !== 'M') return null;
  const legCount = parseInt(raw[1], 10);
  if (Number.isNaN(legCount) || legCount < 1 || legCount > 4) return null;

  const nameField = raw.slice(2, 22).trim();
  if (!nameField) return null;
  const slashIndex = nameField.indexOf('/');
  const lastName = slashIndex >= 0 ? nameField.slice(0, slashIndex) : nameField;
  const firstNameRaw = slashIndex >= 0 ? nameField.slice(slashIndex + 1).trim() : '';
  const firstName = firstNameRaw ? firstNameRaw : undefined;

  const isElectronicTicket = raw[22] === 'E';

  const legs: BoardingPassLeg[] = [];
  let unique: ConditionalUnique = {};
  let cursor = HEADER_LENGTH;

  for (let legIndex = 0; legIndex < legCount; legIndex += 1) {
    if (cursor + LEG_MANDATORY_LENGTH > raw.length) break;
    const mandatory = new Cursor(raw, cursor, cursor + LEG_MANDATORY_LENGTH);

    const pnr = mandatory.readTrimmed(7) ?? '';
    const origin = mandatory.readTrimmed(3) ?? '';
    const destination = mandatory.readTrimmed(3) ?? '';
    const carrier = mandatory.readTrimmed(3) ?? '';
    const flightRaw = mandatory.readTrimmed(5) ?? '';
    const julianString = mandatory.readTrimmed(3) ?? '';
    const compartment = mandatory.readTrimmed(1) ?? '';
    const seatRaw = mandatory.readTrimmed(4) ?? '';
    const checkInSequence = mandatory.readTrimmed(5) ?? '';
    const passengerStatus = mandatory.readTrimmed(1) ?? '';
    const condSize = mandatory.readHexSize() ?? 0;

    const julianDate = parseInt(julianString, 10);
    if (Number.isNaN(julianDate) || julianDate < 1 || julianDate > 366) return null;

    let repeated: ConditionalRepeated = {};
    const condStart = cursor + LEG_MANDATORY_LENGTH;
    const condEnd = Math.min(condStart + condSize, raw.length);
    if (condSize > 0 && condStart < condEnd) {
      const cond = new Cursor(raw, condStart, condEnd);
      if (legIndex === 0) {
        unique = parseUniqueSection(cond, raw, condEnd);
      }
      repeated = parseRepeatedSection(cond, raw, condEnd);
    }

    legs.push({
      pnr,
      origin,
      destination,
      carrier,
      flightNumber: stripLeadingZeros(flightRaw),
      julianDate,
      compartment,
      seat: stripLeadingZeros(seatRaw),
      checkInSequence,
      passengerStatus,
      ...repeated
    });

    cursor += LEG_MANDATORY_LENGTH + condSize;
  }

  if (legs.length === 0) return null;

  return {
    passengerName: nameField,
    lastName,
    firstName,
    isElectronicTicket,
    legs,
    bcbpVersion: unique.version,
    issuerAirline: unique.issuerAirline,
    issueDateCode: unique.issueDateCode,
    baggageTag: unique.baggageTag
  };
}
