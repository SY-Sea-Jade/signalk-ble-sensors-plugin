"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { identifySensorType, decoders } = require("../lib/sensor-types");

test("identifySensorType", async (t) => {
  await t.test("registers every bundled decoder", () => {
    const ids = decoders.map((d) => d.id).sort();
    assert.deepEqual(ids, ["govee", "ruuvitag", "switchbot-meter-plus", "switchbot-th", "xiaomi-atc"]);
  });

  await t.test("returns null for an advertisement with no manufacturer or service data (RSSI-only)", () => {
    const adv = { name: "Unknown Device", manufacturerData: new Map(), serviceData: new Map(), serviceUuids: [] };
    assert.equal(identifySensorType(adv), null);
  });

  await t.test("returns the RuuviTag decoder for a format-5 RuuviTag advertisement", () => {
    const buf = Buffer.alloc(24);
    buf[0] = 5;
    const adv = { name: "", manufacturerData: new Map([[0x0499, buf]]), serviceData: new Map(), serviceUuids: [] };
    assert.equal(identifySensorType(adv).id, "ruuvitag");
  });

  await t.test("only ruuvitag declares providesPressure (the outsidePressureSource dropdown's filter)", () => {
    const providers = decoders.filter((d) => d.providesPressure).map((d) => d.id);
    assert.deepEqual(providers, ["ruuvitag"]);
  });

  await t.test("distinguishes SwitchBot Meter from Meter Plus by model byte", () => {
    const th = {
      name: "",
      manufacturerData: new Map([[0x0969, Buffer.from([0x77, ...Array(11).fill(0)])]]),
      serviceData: new Map(),
      serviceUuids: [],
    };
    assert.equal(identifySensorType(th).id, "switchbot-th");

    const meterPlus = {
      name: "",
      manufacturerData: new Map([[0x0969, Buffer.from([0x69])]]),
      serviceData: new Map([["0000fd3d-0000-1000-8000-00805f9b34fb", Buffer.alloc(6)]]),
      serviceUuids: [],
    };
    assert.equal(identifySensorType(meterPlus).id, "switchbot-meter-plus");
  });
});
