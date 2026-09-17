"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const switchbotTh = require("../../lib/decoders/switchbot-th");

const MANUFACTURER_ID = 0x0969;
const BATTERY_SERVICE_UUID = "0000fd3d-0000-1000-8000-00805f9b34fb";

function buildManufacturerData({ modelId = 0x77, fracDigit = 0, sign = 1, intPart = 0, alarm = 0, humidity = 0 } = {}) {
  const md = Buffer.alloc(12);
  md[0] = modelId;
  md[8] = fracDigit & 0x0f;
  md[9] = (sign > 0 ? 0x80 : 0) | (intPart & 0x7f);
  md[10] = ((alarm ? 1 : 0) << 7) | (humidity & 0x7f);
  return md;
}

function adv({ md, battery } = {}) {
  const manufacturerData = new Map([[MANUFACTURER_ID, md ?? buildManufacturerData()]]);
  const serviceData = new Map();
  if (battery !== undefined) serviceData.set(BATTERY_SERVICE_UUID, Buffer.from([0x00, 0x00, battery]));
  return { name: "", manufacturerData, serviceData };
}

test("switchbot-th identify", async (t) => {
  await t.test("true for 12-byte manufacturer data with model byte 0x77", () => {
    assert.equal(switchbotTh.identify(adv()), true);
  });

  await t.test("false for the Meter Plus model byte", () => {
    assert.equal(switchbotTh.identify(adv({ md: buildManufacturerData({ modelId: 0x69 }) })), false);
  });

  await t.test("false when manufacturer data is the wrong length", () => {
    assert.equal(switchbotTh.identify({ manufacturerData: new Map([[MANUFACTURER_ID, Buffer.alloc(5)]]) }), false);
  });

  await t.test("false when the manufacturer ID is absent", () => {
    assert.equal(switchbotTh.identify({ manufacturerData: new Map() }), false);
  });
});

test("switchbot-th decode", async (t) => {
  await t.test("decodes a positive temperature with a fractional digit", () => {
    const values = switchbotTh.decode(adv({ md: buildManufacturerData({ sign: 1, intPart: 25, fracDigit: 3 }) }));
    assert.equal(values.temp, 298.45); // 273.15 + 25.3
  });

  await t.test("decodes a negative temperature", () => {
    const values = switchbotTh.decode(adv({ md: buildManufacturerData({ sign: -1, intPart: 5, fracDigit: 0 }) }));
    assert.equal(values.temp, 268.15); // 273.15 - 5
  });

  await t.test("decodes humidity ignoring the alarm flag bit", () => {
    const values = switchbotTh.decode(adv({ md: buildManufacturerData({ humidity: 45, alarm: 1 }) }));
    assert.equal(values.humidity, 0.45);
  });

  await t.test("decodes battery strength from service data when present", () => {
    const values = switchbotTh.decode(adv({ battery: 88 }));
    assert.equal(values.battStrength, 0.88);
  });

  await t.test("omits battery strength when no service data is present", () => {
    const values = switchbotTh.decode(adv());
    assert.equal("battStrength" in values, false);
  });
});
