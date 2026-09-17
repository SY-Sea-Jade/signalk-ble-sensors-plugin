"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const ruuvitag = require("../../lib/decoders/ruuvitag");

const MANUFACTURER_ID = 0x0499;

function advWithManufacturerData(buf) {
  return { name: "", manufacturerData: new Map([[MANUFACTURER_ID, buf]]), serviceData: new Map(), serviceUuids: [] };
}

// Data format 5 — https://github.com/ruuvi/ruuvi-sensor-protocols/blob/master/dataformat_05.md
function buildFormat5Buffer({ tempRaw = 0, humidityRaw = 0, pressureRaw = 0, battRaw = 0, txBits = 0, motionCounterRaw = 0 } = {}) {
  const buf = Buffer.alloc(24);
  buf[0] = 5;
  buf.writeInt16BE(tempRaw, 1);
  buf.writeUInt16BE(humidityRaw, 3);
  buf.writeUInt16BE(pressureRaw, 5);
  buf.writeUInt16BE((battRaw << 5) | (txBits & 0x1f), 13);
  buf.writeUInt8(motionCounterRaw, 15);
  return buf;
}

test("ruuvitag identify", async (t) => {
  await t.test("true for format-5 manufacturer data at least 24 bytes long", () => {
    assert.equal(ruuvitag.identify(advWithManufacturerData(buildFormat5Buffer())), true);
  });

  await t.test("false when the manufacturer ID is absent", () => {
    assert.equal(ruuvitag.identify({ manufacturerData: new Map() }), false);
  });

  await t.test("false for a different data format byte", () => {
    const buf = buildFormat5Buffer();
    buf[0] = 3;
    assert.equal(ruuvitag.identify(advWithManufacturerData(buf)), false);
  });

  await t.test("false when the buffer is shorter than 24 bytes", () => {
    assert.equal(ruuvitag.identify(advWithManufacturerData(Buffer.from([5, 0, 0]))), false);
  });
});

test("ruuvitag decode", async (t) => {
  await t.test("decodes a positive temperature, humidity, and pressure", () => {
    const adv = advWithManufacturerData(buildFormat5Buffer({ tempRaw: 2000, humidityRaw: 20000, pressureRaw: 1000 }));
    const values = ruuvitag.decode(adv);
    assert.equal(values.temp, 283.15); // 2000 * 0.005 = 10.0C
    assert.equal(values.humidity, 0.5); // 20000 * 0.0025 / 100
    assert.equal(values.pressure, 51000); // 1000 + 50000
  });

  await t.test("decodes a negative temperature", () => {
    const adv = advWithManufacturerData(buildFormat5Buffer({ tempRaw: -500 }));
    assert.equal(ruuvitag.decode(adv).temp, 270.65); // -500 * 0.005 = -2.5C
  });

  await t.test("decodes battery voltage from the top 11 bits of the power-info field", () => {
    const adv = advWithManufacturerData(buildFormat5Buffer({ battRaw: 400 }));
    assert.equal(ruuvitag.decode(adv).battVoltage, 2.0); // 1.6 + 400/1000
  });

  await t.test("clamps battery strength to [0, 1] against the practical 2.0-3.0V range", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ battRaw: 400 }))).battStrength, 0); // 2.0V -> 0
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ battRaw: 1400 }))).battStrength, 1); // 3.0V -> 1
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ battRaw: 100 }))).battStrength, 0); // below range clamps to 0
  });

  await t.test("decodes the motion counter", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ motionCounterRaw: 42 }))).motionCounter, 42);
  });

  await t.test("passes through a motion counter of 0 rather than dropping it as falsy", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ motionCounterRaw: 0 }))).motionCounter, 0);
  });

  // Sensor-less variants (e.g. the Pro IP68, which only has temperature and
  // the accelerometer motion counter) fill fields they can't measure with the
  // format's "not available" sentinel — largest unsigned/smallest signed
  // representable value — rather than omitting them.
  await t.test("omits temperature for the invalid sentinel (0x8000)", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ tempRaw: -32768 }))).temp, undefined);
  });

  await t.test("omits humidity for the invalid sentinel (0xffff)", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ humidityRaw: 0xffff }))).humidity, undefined);
  });

  await t.test("omits pressure for the invalid sentinel (0xffff)", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ pressureRaw: 0xffff }))).pressure, undefined);
  });

  await t.test("omits battery voltage/strength for the invalid 11-bit sentinel (0x7ff)", () => {
    const values = ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ battRaw: 0x7ff })));
    assert.equal(values.battVoltage, undefined);
    assert.equal(values.battStrength, undefined);
  });

  await t.test("omits the motion counter for the invalid sentinel (0xff)", () => {
    assert.equal(ruuvitag.decode(advWithManufacturerData(buildFormat5Buffer({ motionCounterRaw: 0xff }))).motionCounter, undefined);
  });

  await t.test("temperature-and-motion-only sensor (e.g. Pro IP68): humidity/pressure/battery all invalid", () => {
    const values = ruuvitag.decode(
      advWithManufacturerData(
        buildFormat5Buffer({ tempRaw: 2000, humidityRaw: 0xffff, pressureRaw: 0xffff, battRaw: 0x7ff, motionCounterRaw: 5 }),
      ),
    );
    assert.equal(values.temp, 283.15);
    assert.equal(values.motionCounter, 5);
    assert.equal(values.humidity, undefined);
    assert.equal(values.pressure, undefined);
    assert.equal(values.battVoltage, undefined);
    assert.equal(values.battStrength, undefined);
  });
});
