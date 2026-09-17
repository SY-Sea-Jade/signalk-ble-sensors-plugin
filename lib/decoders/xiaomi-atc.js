"use strict";

// Xiaomi LYWSD03MMC / similar running the pvvx or atc1441 custom firmware
// (https://github.com/pvvx/ATC_MiThermometer) advertises under its own name
// (ATC_XXXXXX, where XXXXXX is the last 3 MAC bytes) with a fixed-format
// service-data payload — no encryption key or GATT connection needed, unlike
// stock Xiaomi firmware. This decodes the firmware's default little-endian
// "custom" format: mac[6] temp[i16LE, x0.01 degC] humidity[u16LE, x0.0001]
// voltage[u16LE, mV] battery[u8, %] counter[u8].

const NAME_PATTERN = /^ATC_[A-Fa-f0-9]{6}$/;
const SERVICE_DATA_UUIDS = ["0000181a-0000-1000-8000-00805f9b34fb", "0000fcd2-0000-1000-8000-00805f9b34fb"];

function getServiceData(adv) {
  for (const uuid of SERVICE_DATA_UUIDS) {
    const sd = adv.serviceData.get(uuid);
    if (sd) return sd;
  }
  return null;
}

function identify(adv) {
  if (!NAME_PATTERN.test(adv.name)) return false;
  const sd = getServiceData(adv);
  return !!sd && sd.length >= 13;
}

function decode(adv) {
  const sd = getServiceData(adv);

  const temp = 273.15 + sd.readInt16LE(6) / 100;
  const humidity = sd.readUInt16LE(8) / 10000;
  const battVoltage = sd.readUInt16LE(10) / 1000;
  const battStrength = sd.readUInt8(12) / 100;

  return { temp, humidity, battVoltage, battStrength };
}

module.exports = {
  id: "xiaomi-atc",
  name: "Xiaomi (ATC/pvvx custom firmware)",
  domain: "environmental",
  identify,
  decode,
};
