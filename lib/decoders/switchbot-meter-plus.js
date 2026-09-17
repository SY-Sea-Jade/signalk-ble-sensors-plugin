"use strict";

// SwitchBot Meter Plus — a newer sibling of the base Meter (switchbot-th.js)
// with its own model byte (0x69) and its temp/humidity/battery all packed
// into the service-data payload instead of manufacturer data. Format per
// https://github.com/OpenWonderLabs/SwitchBotAPI-BLE (devicetypes/meter.md,
// "(new) broadcast message"). No GATT connection needed.

const MANUFACTURER_ID = 0x0969;
const MODEL_ID = 0x69;
const SERVICE_DATA_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb";

function identify(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);
  const sd = adv.serviceData.get(SERVICE_DATA_UUID);
  return !!md && md.length >= 1 && md[0] === MODEL_ID && !!sd && sd.length >= 6;
}

function decode(adv) {
  const sd = adv.serviceData.get(SERVICE_DATA_UUID);

  // Byte 4 bit 7: sign (1 = positive). Byte 4 bits 0-6: integer part.
  // Byte 3 bits 0-3: fractional decimal digit. Byte 5 bit 7: unit flag
  // (1 = the value above is in Fahrenheit rather than Celsius).
  const sign = (sd[4] & 0x80) !== 0 ? 1 : -1;
  const intPart = sd[4] & 0x7f;
  const frac = (sd[3] & 0x0f) / 10;
  const rawTemp = sign * (intPart + frac);
  const isFahrenheit = (sd[5] & 0x80) !== 0;
  const tempC = isFahrenheit ? (rawTemp - 32) / 1.8 : rawTemp;

  const humidity = (sd[5] & 0x7f) / 100;
  const battStrength = sd[2] / 100;

  return { temp: tempC + 273.15, humidity, battStrength };
}

module.exports = {
  id: "switchbot-meter-plus",
  name: "SwitchBot Meter Plus",
  domain: "environmental",
  identify,
  decode,
};
