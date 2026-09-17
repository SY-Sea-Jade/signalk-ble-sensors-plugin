"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { resolvePath, macAndName, sanitize, buildDelta, FIELD_PATHS } = require("../lib/path-mapper");

test("sanitize", async (t) => {
  await t.test("replaces non-alphanumeric runs with a single underscore and trims edges", () => {
    assert.equal(sanitize("My Cabin!! Sensor"), "My_Cabin_Sensor");
    assert.equal(sanitize("  leading and trailing  "), "leading_and_trailing");
  });
});

test("macAndName", async (t) => {
  await t.test("combines a sanitized name and a colon-stripped lowercase mac", () => {
    assert.equal(macAndName("AA:BB:CC:DD:EE:FF", "Cabin Fridge"), "Cabin_Fridge_aabbccddeeff");
  });

  await t.test("falls back to 'sensor' when no name is given", () => {
    assert.equal(macAndName("AA:BB:CC:DD:EE:FF", ""), "sensor_aabbccddeeff");
  });
});

test("resolvePath", async (t) => {
  await t.test("substitutes {zone}", () => {
    assert.equal(
      resolvePath(FIELD_PATHS.temp.path, { zone: "engine room", mac: "AA:BB:CC:DD:EE:FF", name: "Sensor" }),
      "environment.engine_room.temperature",
    );
  });

  await t.test("defaults zone to 'unknown' when not provided", () => {
    assert.equal(resolvePath(FIELD_PATHS.temp.path, { mac: "AA:BB:CC:DD:EE:FF", name: "Sensor" }), "environment.unknown.temperature");
  });

  await t.test("substitutes {macAndName}", () => {
    assert.equal(
      resolvePath(FIELD_PATHS.battStrength.path, { mac: "AA:BB:CC:DD:EE:FF", name: "Cabin" }),
      "sensors.Cabin_aabbccddeeff.battery.strength",
    );
  });
});

test("buildDelta", async (t) => {
  const base = { mac: "AA:BB:CC:DD:EE:FF", name: "Cabin", zone: "cabin", source: "test.ruuvitag" };

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
    assert.deepEqual(delta.updates[0].values, [{ path: "sensors.Cabin_aabbccddeeff.reachable", value: false }]);
  });
});
