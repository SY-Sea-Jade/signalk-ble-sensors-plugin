"use strict";

// RuuviTag "data format 5" — https://github.com/ruuvi/ruuvi-sensor-protocols/blob/master/dataformat_05.md
// Manufacturer-specific advertisement data, no GATT connection needed.

const MANUFACTURER_ID = 0x0499;
const DATA_FORMAT_5 = 5;

// RuuviTags run on a CR2477 coin cell; 2.0V-3.0V is the commonly used
// "practical" range for a rough charge estimate (the ADC itself covers
// 1.6V-3.646V per the spec, but cells are unreliable below ~2.0V).
const BATT_EMPTY_V = 2.0;
const BATT_FULL_V = 3.0;

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function identify(adv) {
  const data = adv.manufacturerData.get(MANUFACTURER_ID);
  return !!data && data.length >= 24 && data[0] === DATA_FORMAT_5;
}

function decode(adv) {
  const buf = adv.manufacturerData.get(MANUFACTURER_ID);

  const temp = 273.15 + buf.readInt16BE(1) * 0.005;
  const humidity = (buf.readUInt16BE(3) * 0.0025) / 100;
  const pressure = buf.readUInt16BE(5) + 50000;

  const battRaw = buf.readUInt16BE(13);
  const battVoltage = 1.6 + (battRaw >> 5) / 1000;
  const battStrength = clamp01((battVoltage - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V));

  return { temp, humidity, pressure, battVoltage, battStrength };
}

module.exports = {
  id: "ruuvitag",
  name: "RuuviTag",
  domain: "environmental",
  identify,
  decode,
};
