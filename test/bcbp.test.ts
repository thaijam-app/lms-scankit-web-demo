import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBCBP } from '../src/bcbp.js';

const singleLeg = 'M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A0025 100';

test('解析單航段必填欄位', () => {
  const pass = parseBCBP(singleLeg);
  assert.ok(pass);
  assert.equal(pass.lastName, 'DESMARAIS');
  assert.equal(pass.firstName, 'LUC');
  assert.equal(pass.isElectronicTicket, true);
  const leg = pass.legs[0];
  assert.equal(leg.pnr, 'ABC123');
  assert.equal(leg.origin, 'YUL');
  assert.equal(leg.destination, 'FRA');
  assert.equal(leg.carrier, 'AC');
  assert.equal(leg.flightNumber, '834');
  assert.equal(leg.julianDate, 226);
  assert.equal(leg.compartment, 'F');
  assert.equal(leg.seat, '1A');
});

test('拒絕非 BCBP 內容', () => {
  assert.equal(parseBCBP('https://example.com/member/12345'), null);
  assert.equal(parseBCBP('1234567890128'), null);
  assert.equal(parseBCBP(''), null);
  assert.equal(parseBCBP('M'), null);
});

test('真實 v8 票：截斷 conditional＋航司自用區＋非 E 電子票欄位', () => {
  const raw =
    'M1BKKAPP/AAAA         TESTAA5 TPEBKKBR 0067 145C010A0100 377>8320 W5209BBR' +
    '                                        2A69525012345670 BR NH 3123000002          Y*30600000K09  NHG';
  const pass = parseBCBP(raw);
  assert.ok(pass);
  assert.equal(pass.lastName, 'BKKAPP');
  assert.equal(pass.bcbpVersion, '8');
  const leg = pass.legs[0];
  assert.equal(leg.origin, 'TPE');
  assert.equal(leg.destination, 'BKK');
  assert.equal(leg.carrier, 'BR');
  assert.equal(leg.flightNumber, '67');
  assert.equal(leg.seat, '10A');
  assert.equal(leg.marketingCarrier, 'BR');
  assert.equal(leg.frequentFlyerAirline, 'NH');
  assert.equal(leg.frequentFlyerNumber, '3123000002');
  assert.equal(leg.fastTrack, true);
});

test('conditional 截斷時必填欄位仍解出、缺項為 undefined', () => {
  const full =
    'M1LIN/JIMMY           E' +
    'ABC123 TPESINBR 0087 226Y012F0033 148' +
    '>618' + '0WW6226BBR 0298123456003' +
    '2A' + '695123456789001BR BR BR123456789     020KY';
  const truncated = full.slice(0, 23 + 37 + 10);
  const pass = parseBCBP(truncated);
  assert.ok(pass);
  assert.equal(pass.lastName, 'LIN');
  assert.equal(pass.bcbpVersion, '6');
  assert.equal(pass.baggageTag, undefined);
  assert.equal(pass.legs[0].frequentFlyerNumber, undefined);

  const complete = parseBCBP(full);
  assert.ok(complete);
  assert.equal(complete.baggageTag, '0298123456003');
  assert.equal(complete.legs[0].frequentFlyerNumber, 'BR123456789');
  assert.equal(complete.legs[0].fastTrack, true);
});
