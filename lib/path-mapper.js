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
    path: "sensors.{macAndName}.battery.voltage",
    unit: "V",
    description: "Sensor battery voltage",
  },
  battStrength: {
    path: "sensors.{macAndName}.battery.strength",
    unit: "ratio",
    description: "Sensor battery strength",
    zones: [
      { lower: 0.3, upper: 0.5, state: "alert", message: "Battery low - change soon" },
      { lower: 0, upper: 0.3, state: "warn", message: "Battery very low - change now" },
    ],
  },
  rssi: {
    path: "sensors.{macAndName}.RSSI",
    unit: "dB",
    description: "Sensor signal strength in decibels",
  },
  reachable: {
    path: "sensors.{macAndName}.reachable",
    description: "Whether the sensor is currently in Bluetooth contact",
  },
};

function sanitize(str) {
  return String(str)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function macAndName(mac, name) {
  return `${sanitize(name || "sensor")}_${String(mac).replace(/:/g, "").toLowerCase()}`;
}

function resolvePath(template, { zone, mac, name }) {
  return template.replace("{zone}", sanitize(zone || "unknown")).replace("{macAndName}", macAndName(mac, name));
}

// Builds a SignalK delta from a decoder's { tag: value } output. Unknown
// tags and null/undefined/NaN values are dropped rather than published —
// callers don't need to filter decoder output themselves.
function buildDelta({ mac, name, zone, values, source }) {
  const deltaValues = [];
  for (const [tag, value] of Object.entries(values)) {
    const meta = FIELD_PATHS[tag];
    if (!meta || value === undefined || value === null || (typeof value === "number" && Number.isNaN(value))) continue;
    deltaValues.push({ path: resolvePath(meta.path, { zone, mac, name }), value });
  }
  if (deltaValues.length === 0) return null;
  return {
    updates: [{ $source: source, timestamp: new Date().toISOString(), values: deltaValues }],
  };
}

module.exports = { FIELD_PATHS, resolvePath, macAndName, sanitize, buildDelta };
