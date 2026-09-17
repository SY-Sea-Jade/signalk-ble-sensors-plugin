"use strict";

// SwitchBot Meter (WoSensorTH) — manufacturer-data + service-data advertisement
// format documented at https://github.com/OpenWonderLabs/SwitchBotAPI-BLE
// (devicetypes/meter.md). No GATT connection needed.

const MANUFACTURER_ID = 0x0969;
const MODEL_ID = 0x77; // 'w' — distinguishes the base Meter from Meter Plus (0x69)
// Some firmware/chip revisions prefix manufacturerData with the device's own
// MAC address instead of putting the model byte at offset 0. Byte 6 (right
// after the MAC) was initially assumed to be a stable device-type/mode byte
// per OpenWonderLabs's device-type table (0x74 't' / 0x54 'T' for WoSensorTH)
// — but a second capture from the same physical device showed it change
// (0x74 -> 0x75) between advertisements while the sensor payload after it
// stayed identical, so it's some kind of rolling counter, not a fixed
// discriminator. Don't gate on its value. The MAC match alone is already a
// ~1-in-2^48 signal, so it's sufficient on its own; the payload after it is
// otherwise the same shape, and since the buffer is still 12 bytes total
// either way, the temp/humidity offsets below land in the same place
// regardless of variant.
const BATTERY_SERVICE_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb";

function macBytesMatch(md, mac) {
  if (!mac) return false;
  return md.subarray(0, 6).toString("hex") === String(mac).replace(/:/g, "").toLowerCase();
}

function identify(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);
  if (!md || md.length !== 12) return false;
  return md[0] === MODEL_ID || macBytesMatch(md, adv.mac);
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

  // Byte 2 bit 7 is an "update UTC" flag, not part of the value — per
  // OpenWonderLabs's Service Data table (Byte 2: "Update UTC Flag Battery",
  // bit[6:0] = remaining battery 0-100%).
  const sd = adv.serviceData.get(BATTERY_SERVICE_UUID);
  if (sd && sd.length >= 3) {
    result.battStrength = (sd[2] & 0x7f) / 100;
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
