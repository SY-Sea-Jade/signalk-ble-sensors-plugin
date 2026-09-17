"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const meterPlus = require("../../lib/decoders/switchbot-meter-plus");

const MANUFACTURER_ID = 0x0969;
const SERVICE_DATA_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb";

function buildServiceData({ battery = 0, fracDigit = 0, sign = 1, intPart = 0, fahrenheit = false, humidity = 0 } = {}) {
  const sd = Buffer.alloc(6);
  sd[2] = battery;
  sd[3] = fracDigit & 0x0f;
  sd[4] = (sign > 0 ? 0x80 : 0) | (intPart & 0x7f);
  sd[5] = ((fahrenheit ? 1 : 0) << 7) | (humidity & 0x7f);
  return sd;
}

function adv({ modelId = 0x69, sd } = {}) {
  return {
    name: "",
    manufacturerData: new Map([[MANUFACTURER_ID, Buffer.from([modelId])]]),
    serviceData: new Map([[SERVICE_DATA_UUID, sd ?? buildServiceData()]]),
  };
}

test("switchbot-meter-plus identify", async (t) => {
  await t.test("true for model byte 0x69 plus service data", () => {
    assert.equal(meterPlus.identify(adv()), true);
  });

  await t.test("false for the base Meter's model byte", () => {
    assert.equal(meterPlus.identify(adv({ modelId: 0x77 })), false);
  });

  await t.test("false when service data is missing", () => {
    assert.equal(
      meterPlus.identify({ manufacturerData: new Map([[MANUFACTURER_ID, Buffer.from([0x69])]]), serviceData: new Map() }),
      false,
    );
  });
});

test("switchbot-meter-plus decode", async (t) => {
  await t.test("decodes a Celsius temperature, humidity, and battery from service data", () => {
    const values = meterPlus.decode(adv({ sd: buildServiceData({ battery: 75, sign: 1, intPart: 22, fracDigit: 7, humidity: 60 }) }));
    assert.equal(Math.round(values.temp * 100) / 100, 295.85); // 273.15 + 22.7
    assert.equal(values.humidity, 0.6);
    assert.equal(values.battStrength, 0.75);
  });

  await t.test("converts Fahrenheit to Kelvin when the unit flag is set", () => {
    const values = meterPlus.decode(adv({ sd: buildServiceData({ sign: 1, intPart: 98, fracDigit: 6, fahrenheit: true }) }));
    assert.equal(Math.round(values.temp * 100) / 100, 310.15); // 98.6F == 37.0C == 310.15K
  });

  await t.test("decodes a negative Celsius temperature", () => {
    const values = meterPlus.decode(adv({ sd: buildServiceData({ sign: -1, intPart: 3, fracDigit: 0 }) }));
    assert.equal(values.temp, 270.15); // 273.15 - 3
  });
});
