"use strict";

// Govee H5074/H5075 thermo-hygrometers advertise manufacturer data under
// Govee's ID (0xEC88); the two models pack it differently, distinguished by
// each device's advertised name. No GATT connection needed.

const MANUFACTURER_ID = 0xec88;
const H5075_NAME = /^Govee_H5075_[0-9A-Fa-f]{4}$/;
const H5074_NAME = /^Govee_H5074_[0-9A-Fa-f]{4}$/;

function identify(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);
  if (!md) return false;
  return (H5075_NAME.test(adv.name) && md.length >= 6) || (H5074_NAME.test(adv.name) && md.length >= 6);
}

function decodeH5075(md) {
  // 3-byte big-endian packed value: sign bit on the top byte, then
  // temp-in-tenths-of-a-degree * 1000 + humidity-in-hundredths-of-a-percent.
  const negative = (md[1] & 0x80) !== 0;
  const packed = (md.readUIntBE(1, 3) & 0xffffff) ^ (negative ? 0x800000 : 0);
  const tempTenths = Math.trunc(packed / 1000) * (negative ? -1 : 1);
  const temp = 273.15 + tempTenths / 10;
  const humidity = (packed % 1000) / 1000;
  const battStrength = md[4] / 100;
  return { temp, humidity, battStrength };
}

function decodeH5074(md) {
  const temp = 273.15 + md.readInt16LE(1) / 100;
  const humidity = md.readUInt16LE(3) / 10000;
  const battStrength = md.readUInt8(5) / 100;
  return { temp, humidity, battStrength };
}

function decode(adv) {
  const md = adv.manufacturerData.get(MANUFACTURER_ID);
  return H5075_NAME.test(adv.name) ? decodeH5075(md) : decodeH5074(md);
}

module.exports = {
  id: "govee",
  name: "Govee H5074/H5075",
  domain: "environmental",
  identify,
  decode,
};
