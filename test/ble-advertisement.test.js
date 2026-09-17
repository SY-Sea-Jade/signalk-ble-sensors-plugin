"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAdvertisement } = require("../lib/ble-advertisement");

test("normalizeAdvertisement", async (t) => {
  await t.test("hex-decodes manufacturerData keyed by numeric ID into Buffers", () => {
    const adv = normalizeAdvertisement({
      mac: "AA:BB:CC:DD:EE:FF",
      name: "Thing",
      rssi: -60,
      manufacturerData: { 1177: "0102ff" },
    });
    assert.deepEqual(adv.manufacturerData.get(1177), Buffer.from([0x01, 0x02, 0xff]));
  });

  await t.test("hex-decodes serviceData keyed by lowercased UUID into Buffers", () => {
    const adv = normalizeAdvertisement({
      mac: "AA:BB:CC:DD:EE:FF",
      rssi: -60,
      serviceData: { "0000FD3D-0000-1000-8000-00805F9B34FB": "0a0b0c" },
    });
    assert.deepEqual(adv.serviceData.get("0000fd3d-0000-1000-8000-00805f9b34fb"), Buffer.from([0x0a, 0x0b, 0x0c]));
  });

  await t.test("lowercases serviceUuids", () => {
    const adv = normalizeAdvertisement({
      mac: "AA:BB:CC:DD:EE:FF",
      rssi: -60,
      serviceUuids: ["0000FE95-0000-1000-8000-00805F9B34FB"],
    });
    assert.deepEqual(adv.serviceUuids, ["0000fe95-0000-1000-8000-00805f9b34fb"]);
  });

  await t.test("defaults absent fields to empty collections and empty name", () => {
    const adv = normalizeAdvertisement({ mac: "AA:BB:CC:DD:EE:FF", rssi: -60 });
    assert.equal(adv.manufacturerData.size, 0);
    assert.equal(adv.serviceData.size, 0);
    assert.deepEqual(adv.serviceUuids, []);
    assert.equal(adv.name, "");
  });

  await t.test("passes mac and rssi through unchanged", () => {
    const adv = normalizeAdvertisement({ mac: "AA:BB:CC:DD:EE:FF", rssi: -72 });
    assert.equal(adv.mac, "AA:BB:CC:DD:EE:FF");
    assert.equal(adv.rssi, -72);
  });
});
