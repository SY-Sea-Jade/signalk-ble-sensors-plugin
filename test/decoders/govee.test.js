"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const govee = require("../../lib/decoders/govee");

const MANUFACTURER_ID = 0xec88;

function adv({ name, md }) {
  return { name, manufacturerData: new Map([[MANUFACTURER_ID, md]]), serviceData: new Map() };
}

test("govee identify", async (t) => {
  await t.test("true for an H5075 name with 6+ bytes of manufacturer data", () => {
    assert.equal(govee.identify(adv({ name: "Govee_H5075_AB12", md: Buffer.alloc(6) })), true);
  });

  await t.test("true for an H5074 name with 6+ bytes of manufacturer data", () => {
    assert.equal(govee.identify(adv({ name: "Govee_H5074_AB12", md: Buffer.alloc(6) })), true);
  });

  await t.test("false for an unrelated name", () => {
    assert.equal(govee.identify(adv({ name: "Govee_H5051_AB12", md: Buffer.alloc(6) })), false);
  });

  await t.test("false when manufacturer data is absent", () => {
    assert.equal(govee.identify({ name: "Govee_H5075_AB12", manufacturerData: new Map() }), false);
  });
});

test("govee decode", async (t) => {
  await t.test("decodes an H5075 negative-temperature packed reading", () => {
    // 3-byte packed field 0x81C289 -> sign bit set, magnitude 0x01C289 = 115337
    const values = govee.decode(adv({ name: "Govee_H5075_AB12", md: Buffer.from([0x00, 0x81, 0xc2, 0x89, 0x64, 0x00]) }));
    assert.equal(Math.round(values.temp * 100) / 100, 261.65); // 273.15 - 11.5
    assert.equal(Math.round(values.humidity * 1000) / 1000, 0.337);
    assert.equal(values.battStrength, 1.0);
  });

  await t.test("decodes an H5075 positive-temperature packed reading", () => {
    // 3-byte packed field 0x03BB94, no sign bit -> magnitude 244628
    const values = govee.decode(adv({ name: "Govee_H5075_AB12", md: Buffer.from([0x00, 0x03, 0xbb, 0x94, 0x64, 0x00]) }));
    assert.equal(Math.round(values.temp * 100) / 100, 297.55); // 273.15 + 24.4
    assert.equal(Math.round(values.humidity * 1000) / 1000, 0.628);
    assert.equal(values.battStrength, 1.0);
  });

  await t.test("decodes an H5074 reading from separate little-endian fields", () => {
    const md = Buffer.alloc(6);
    md.writeInt16LE(2200, 1);
    md.writeUInt16LE(5678, 3);
    md.writeUInt8(90, 5);
    const values = govee.decode(adv({ name: "Govee_H5074_AB12", md }));
    assert.equal(values.temp, 295.15); // 273.15 + 22.0
    assert.equal(values.humidity, 0.5678);
    assert.equal(values.battStrength, 0.9);
  });
});
