"use strict";

// SwitchBot Meter (WoSensorTH) — manufacturer-data + service-data advertisement
// format documented at https://github.com/OpenWonderLabs/SwitchBotAPI-BLE
// (devicetypes/meter.md). No GATT connection needed.

const MANUFACTURER_ID = 0x0969;
const MODEL_ID = 0x77; // 'w' — distinguishes the base Meter from Meter Plus (0x69)
const BATTERY_SERVICE_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb";

function identify(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);
  return !!md && md.length === 12 && md[0] === MODEL_ID;
}

function decode(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);

  // Byte 9 bit 7: sign (1 = positive). Byte 9 bits 0-6: integer part (°C).
  // Byte 8 bits 0-3: fractional decimal digit (tenths of a degree).
  const sign = (md[9] & 0x80) !== 0 ? 1 : -1;
  const intPart = md[9] & 0x7f;
  const frac = (md[8] & 0x0f) / 10;
  const temp = 273.15 + sign * (intPart + frac);

  // Byte 10 bit 7 is an alarm flag, not part of the value.
  const humidity = (md[10] & 0x7f) / 100;

  const result = { temp, humidity };

  const sd = adv.serviceData.get(BATTERY_SERVICE_UUID);
  if (sd && sd.length >= 3) {
    result.battStrength = sd[2] / 100;
  }

  return result;
}

module.exports = {
  id: "switchbot-th",
  name: "SwitchBot Meter",
  domain: "environmental",
  identify,
  decode,
};
