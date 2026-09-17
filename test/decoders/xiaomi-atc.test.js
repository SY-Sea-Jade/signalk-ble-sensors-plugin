"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const xiaomiAtc = require("../../lib/decoders/xiaomi-atc");

const SERVICE_UUID = "0000181a-0000-1000-8000-00805f9b34fb";

function buildServiceData({ tempRaw = 0, humidityRaw = 0, voltageRaw = 0, battery = 0 } = {}) {
  const sd = Buffer.alloc(13);
  sd.writeInt16LE(tempRaw, 6);
  sd.writeUInt16LE(humidityRaw, 8);
  sd.writeUInt16LE(voltageRaw, 10);
  sd[12] = battery;
  return sd;
}

function adv({ name = "ATC_1A2B3C", sd } = {}) {
  return { name, manufacturerData: new Map(), serviceData: new Map([[SERVICE_UUID, sd ?? buildServiceData()]]) };
}

test("xiaomi-atc identify", async (t) => {
  await t.test("true for an ATC_XXXXXX name with matching service data", () => {
    assert.equal(xiaomiAtc.identify(adv()), true);
  });

  await t.test("false for a name that doesn't match the ATC_ pattern", () => {
    assert.equal(xiaomiAtc.identify(adv({ name: "LYWSD03MMC" })), false);
  });

  await t.test("false when the service data is too short", () => {
    assert.equal(xiaomiAtc.identify({ name: "ATC_1A2B3C", serviceData: new Map([[SERVICE_UUID, Buffer.alloc(5)]]) }), false);
  });
});

test("xiaomi-atc decode", async (t) => {
  await t.test("decodes temperature, humidity, battery voltage and strength", () => {
    const values = xiaomiAtc.decode(adv({ sd: buildServiceData({ tempRaw: 2345, humidityRaw: 4567, voltageRaw: 2980, battery: 77 }) }));
    assert.equal(Math.round(values.temp * 100) / 100, 296.6); // 273.15 + 23.45
    assert.equal(values.humidity, 0.4567);
    assert.equal(values.battVoltage, 2.98);
    assert.equal(values.battStrength, 0.77);
  });

  await t.test("decodes a negative temperature", () => {
    const values = xiaomiAtc.decode(adv({ sd: buildServiceData({ tempRaw: -150 }) }));
    assert.equal(values.temp, 271.65); // 273.15 - 1.5
  });
});
