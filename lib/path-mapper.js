"use strict";

// SignalK path/unit conventions reused from bt-sensors-plugin-sk's
// plugin_defaults.json (https://github.com/naugehyde/bt-sensors-plugin-sk) —
// path templates, units and battery-low zones only; the decoding and
// templating code here is our own, written for this plugin's BLE-Manager-only,
// passive-advertisement design.
const FIELD_PATHS = {
  temp: {
    path: "environment.{zone}.temperature",
    unit: "K",
    description: "Zone's current temperature",
  },
  humidity: {
    path: "environment.{zone}.humidity",
    unit: "ratio",
    description: "Zone's current humidity",
  },
  pressure: {
    path: "environment.{zone}.pressure",
    unit: "Pa",
    description: "Zone's current ambient air pressure",
  },
  battVoltage: {
    path: "sensors.{sensorId}.battery.voltage",
    unit: "V",
    description: "Sensor battery voltage",
  },
  battStrength: {
    path: "sensors.{sensorId}.battery.strength",
    unit: "ratio",
    description: "Sensor battery strength",
    zones: [
      { lower: 0.3, upper: 0.5, state: "alert", message: "Battery low - change soon" },
      { lower: 0, upper: 0.3, state: "warn", message: "Battery very low - change now" },
    ],
  },
  rssi: {
    path: "sensors.{sensorId}.RSSI",
    unit: "dB",
    description: "Sensor signal strength in decibels",
  },
  reachable: {
    path: "sensors.{sensorId}.reachable",
    description: "Whether the sensor is currently in Bluetooth contact",
  },
};

function sanitize(str) {
  return String(str)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function sensorId(name) {
  return sanitize(name || "sensor").toLowerCase();
}

// A zone of "inside.mainCabin" nests into environment.inside.mainCabin.* —
// each dot-separated segment is sanitized independently so a stray invalid
// character in one segment doesn't merge it into its neighbor.
function sanitizeZone(zone) {
  const segments = String(zone || "")
    .split(".")
    .map(sanitize)
    .filter(Boolean);
  return segments.length > 0 ? segments.join(".") : "unknown";
}

function resolvePath(template, { zone, name }) {
  return template.replace("{zone}", sanitizeZone(zone)).replace("{sensorId}", sensorId(name));
}

// Builds a SignalK delta from a decoder's { tag: value } output. Unknown
// tags and null/undefined/NaN values are dropped rather than published —
// callers don't need to filter decoder output themselves.
function buildDelta({ name, zone, values, source }) {
  const deltaValues = [];
  for (const [tag, value] of Object.entries(values)) {
    const meta = FIELD_PATHS[tag];
    if (!meta || value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) continue;
    deltaValues.push({ path: resolvePath(meta.path, { zone, name }), value });
  }
  if (deltaValues.length === 0) return null;
  return {
    updates: [{ $source: source, timestamp: new Date().toISOString(), values: deltaValues }],
  };
}

// Builds the SignalK meta delta (units, description, alarm zones) for the
// paths a decoder's { tag: value } output maps to. Without this, the server
// has no unit metadata for plugin-defined paths like environment.<zone>.* or
// sensors.<sensorId>.* (unlike the fixed paths in the SignalK spec, e.g.
// environment.outside.temperature), so webapps display raw numbers — e.g. a
// temperature of 287.04 with no indication it's Kelvin — instead of
// converting/labelling them.
function buildMetaDelta({ name, zone, values, source }) {
  const metas = [];
  for (const tag of Object.keys(values)) {
    const meta = FIELD_PATHS[tag];
    if (!meta) continue;
    const metaValue = {};
    if (meta.unit) metaValue.units = meta.unit;
    if (meta.description) metaValue.description = meta.description;
    if (meta.zones) metaValue.zones = meta.zones;
    metas.push({ path: resolvePath(meta.path, { zone, name }), value: metaValue });
  }
  if (metas.length === 0) return null;
  return {
    updates: [{ $source: source, timestamp: new Date().toISOString(), meta: metas }],
  };
}

module.exports = { FIELD_PATHS, resolvePath, sensorId, sanitize, sanitizeZone, buildDelta, buildMetaDelta };
