"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolvePath, sensorId, sanitize, buildDelta, buildMetaDelta, FIELD_PATHS } = require("../lib/path-mapper");

test("sanitize", async (t) => {
  await t.test("replaces non-alphanumeric runs with a single underscore and trims edges", () => {
    assert.equal(sanitize("My Cabin!! Sensor"), "My_Cabin_Sensor");
    assert.equal(sanitize("  leading and trailing  "), "leading_and_trailing");
  });
});

test("sensorId", async (t) => {
  await t.test("sanitizes and lowercases the name", () => {
    assert.equal(sensorId("Cabin Fridge"), "cabin_fridge");
  });

  await t.test("falls back to 'sensor' when no name is given", () => {
    assert.equal(sensorId(""), "sensor");
  });
});

test("resolvePath", async (t) => {
  await t.test("substitutes {zone}", () => {
    assert.equal(resolvePath(FIELD_PATHS.temp.path, { zone: "engine room", name: "Sensor" }), "environment.engine_room.temperature");
  });

  await t.test("defaults zone to 'unknown' when not provided", () => {
    assert.equal(resolvePath(FIELD_PATHS.temp.path, { name: "Sensor" }), "environment.unknown.temperature");
  });

  await t.test("substitutes {sensorId}", () => {
    assert.equal(resolvePath(FIELD_PATHS.battStrength.path, { name: "Cabin" }), "sensors.cabin.battery.strength");
  });
});

test("buildDelta", async (t) => {
  const base = { name: "Cabin", zone: "cabin", source: "test.ruuvitag" };

  await t.test("builds a values array from known tags", () => {
    const delta = buildDelta({ ...base, values: { temp: 295.15, humidity: 0.5 } });
    assert.equal(delta.updates.length, 1);
    assert.equal(delta.updates[0].$source, "test.ruuvitag");
    assert.deepEqual(delta.updates[0].values, [
      { path: "environment.cabin.temperature", value: 295.15 },
      { path: "environment.cabin.humidity", value: 0.5 },
    ]);
  });

  await t.test("drops tags with no known path mapping", () => {
    const delta = buildDelta({ ...base, values: { temp: 295.15, unknownTag: 42 } });
    assert.equal(delta.updates[0].values.length, 1);
  });

  await t.test("drops null, undefined, and NaN values", () => {
    const delta = buildDelta({ ...base, values: { temp: 295.15, humidity: null, pressure: undefined, battVoltage: NaN } });
    assert.equal(delta.updates[0].values.length, 1);
  });

  await t.test("returns null when nothing survives filtering", () => {
    assert.equal(buildDelta({ ...base, values: { unknownTag: 1 } }), null);
  });

  await t.test("passes boolean values (e.g. reachable) through unfiltered", () => {
    const delta = buildDelta({ ...base, values: { reachable: false } });
    assert.deepEqual(delta.updates[0].values, [{ path: "sensors.cabin.reachable", value: false }]);
  });
});

test("buildMetaDelta", async (t) => {
  const base = { name: "Cabin", zone: "cabin", source: "test.ruuvitag" };

  await t.test("builds units/description meta for known tags", () => {
    const meta = buildMetaDelta({ ...base, values: { temp: 295.15, humidity: 0.5 } });
    assert.equal(meta.updates.length, 1);
    assert.equal(meta.updates[0].$source, "test.ruuvitag");
    assert.deepEqual(meta.updates[0].meta, [
      { path: "environment.cabin.temperature", value: { units: "K", description: "Zone's current temperature" } },
      { path: "environment.cabin.humidity", value: { units: "ratio", description: "Zone's current humidity" } },
    ]);
  });

  await t.test("includes zones for fields that declare them (e.g. battStrength)", () => {
    const meta = buildMetaDelta({ ...base, values: { battStrength: 0.8 } });
    assert.deepEqual(meta.updates[0].meta[0].value.zones, FIELD_PATHS.battStrength.zones);
  });

  await t.test("omits units for fields with none (e.g. reachable)", () => {
    const meta = buildMetaDelta({ ...base, values: { reachable: true } });
    assert.deepEqual(meta.updates[0].meta, [
      { path: "sensors.cabin.reachable", value: { description: "Whether the sensor is currently in Bluetooth contact" } },
    ]);
  });

  await t.test("drops tags with no known path mapping", () => {
    const meta = buildMetaDelta({ ...base, values: { unknownTag: 42 } });
    assert.equal(meta, null);
  });
});
