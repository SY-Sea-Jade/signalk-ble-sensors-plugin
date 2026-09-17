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

// Sensor-less variants (e.g. the Pro IP68, which only has temperature and the
// accelerometer-driven motion counter) fill the fields they can't measure
// with the format's "not available" sentinel rather than omitting them:
// largest representable value for unsigned fields, smallest for signed ones.
// Decoding those as real numbers would publish nonsense (e.g. the invalid
// humidity sentinel 0xffff decodes to 163.8% if not filtered out here).
const TEMP_INVALID = -32768; // 0x8000 as int16
const HUMIDITY_INVALID = 0xffff;
const PRESSURE_INVALID = 0xffff;
const BATT_VOLTAGE_11BIT_INVALID = 0x7ff;
const MOTION_COUNTER_INVALID = 0xff;

function decode(adv) {
  const buf = adv.manufacturerData.get(MANUFACTURER_ID);

  const rawTemp = buf.readInt16BE(1);
  const temp = rawTemp === TEMP_INVALID ? undefined : 273.15 + rawTemp * 0.005;

  const rawHumidity = buf.readUInt16BE(3);
  const humidity = rawHumidity === HUMIDITY_INVALID ? undefined : (rawHumidity * 0.0025) / 100;

  const rawPressure = buf.readUInt16BE(5);
  const pressure = rawPressure === PRESSURE_INVALID ? undefined : rawPressure + 50000;

  const battMillivolts11Bit = buf.readUInt16BE(13) >> 5;
  let battVoltage;
  let battStrength;
  if (battMillivolts11Bit !== BATT_VOLTAGE_11BIT_INVALID) {
    battVoltage = 1.6 + battMillivolts11Bit / 1000;
    battStrength = clamp01((battVoltage - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V));
  }

  const rawMotionCounter = buf.readUInt8(15);
  const motionCounter = rawMotionCounter === MOTION_COUNTER_INVALID ? undefined : rawMotionCounter;

  return { temp, humidity, pressure, battVoltage, battStrength, motionCounter };
}

module.exports = {
  id: "ruuvitag",
  name: "RuuviTag",
  domain: "environmental",
  identify,
  decode,
};
