"use strict";

module.exports = function (app) {
  const plugin = {};
  plugin.id = "signalk-ble-sensors-plugin";
  plugin.name = "BLE Sensors (Passive)";
  plugin.description =
    "Passively listens to BLE advertisements from supported sensors (SwitchBot, RuuviTag, and others) via the SignalK BLE Manager API — no GATT connection required.";

  // Lazy-required so a dependency load failure surfaces as a plugin error
  // rather than crashing the server (mirrors the sibling signalk-bluetti-plugin).
  let manager = null;

  plugin.schema = function () {
    const recognized = manager ? manager.getRecognizedDevices() : [];
    const configured = manager ? manager.getConfiguredDevices() : [];
    const outsidePressureSourceMac = manager ? manager.getOutsidePressureSourceMac() : null;
    return buildSchema(recognized, configured, outsidePressureSourceMac);
  };

  plugin.start = function (options = {}) {
    if (!app.bleApi) {
      const msg =
        "BLE Manager API (app.bleApi) is not available on this SignalK server — requires server >= 2.31.0 with Bluetooth enabled.";
      app.setPluginError(msg);
      return;
    }

    const SensorManager = require("./lib/sensor-manager");
    manager = new SensorManager(app, plugin.id, (msg) => app.debug(msg));
    manager.configure(options);

    try {
      manager.start();
    } catch (err) {
      app.setPluginError(err.message);
      manager = null;
      return;
    }

    const count = (options.sensors || []).filter((s) => s.enabled !== false).length;
    app.setPluginStatus(`Listening for BLE sensor advertisements (${count} sensor${count === 1 ? "" : "s"} registered)`);
  };

  plugin.stop = function () {
    if (manager) {
      manager.stop();
      manager = null;
    }
  };

  return plugin;
};

function normalizeMac(mac) {
  return String(mac).toLowerCase();
}

// adv.name is frequently blank for these sensors — SwitchBot and RuuviTag
// decode entirely from manufacturer/service data and don't depend on the BLE
// advertised name, which many providers never surface anyway (it's typically
// only present in a scan response, not the primary advertising packet). Drop
// the name segment rather than showing a literal placeholder. RSSI is
// appended as a live disambiguator: with a neighboring boat's identical
// sensor model also in range, the stronger (less negative) signal is
// generally the one actually on this boat. sensorTypeName is only known once
// a device's advertisement has actually been decoded — a registered MAC not
// yet re-observed since the plugin last started (see mergeKnownWithConfigured
// below) won't have one.
function formatDeviceLabel(d) {
  const namePart = d.name ? `${d.name} — ` : "";
  const typePart = d.sensorTypeName || "not seen since restart";
  const rssiPart = d.rssi === undefined || d.rssi === null ? "" : ` · ${d.rssi}dBm`;
  return `${namePart}${typePart} (${d.mac})${rssiPart}`;
}

// _recognized (and therefore getRecognizedDevices()) is runtime-only and
// resets on every plugin restart, while a MAC already saved in options.sensors
// persists across restarts. Without this merge, a registered sensor's MAC
// would vanish from the dropdown's enum until it happened to broadcast again,
// making an already-saved selection look like it disappeared even though
// it's still in the config. Merged-in entries carry no sensorTypeName (we
// only learn that by decoding an actual advertisement) or providesPressure
// (safe default: false, so they can't wrongly appear in the pressure-source
// dropdown until re-observed confirms what they are).
function mergeKnownWithConfigured(recognized, configured) {
  const byMac = new Map(recognized.map((d) => [normalizeMac(d.mac), d]));
  for (const c of configured) {
    if (!c || !c.mac || byMac.has(normalizeMac(c.mac))) continue;
    byMac.set(normalizeMac(c.mac), { mac: c.mac, name: c.name, sensorTypeName: null, providesPressure: false, rssi: undefined });
  }
  return [...byMac.values()];
}

function buildSchema(recognized, configured = [], outsidePressureSourceMac = null) {
  const known = mergeKnownWithConfigured(recognized, configured).sort((a, b) => a.mac.localeCompare(b.mac));
  const hasKnown = known.length > 0;

  let pressureCapable = known.filter((d) => d.providesPressure);
  // Same rationale as above, for the single outsidePressureSource pick: keep
  // it selectable even if the device hasn't re-confirmed its pressure
  // capability since the last restart.
  if (outsidePressureSourceMac && !pressureCapable.some((d) => normalizeMac(d.mac) === normalizeMac(outsidePressureSourceMac))) {
    pressureCapable = [...pressureCapable, { mac: outsidePressureSourceMac, name: null, sensorTypeName: null, rssi: undefined }].sort(
      (a, b) => a.mac.localeCompare(b.mac),
    );
  }
  const hasPressureCapable = pressureCapable.length > 0;

  return {
    type: "object",
    properties: {
      outsidePressureSource: {
        type: "string",
        title: "Outside pressure source",
        description:
          "Optional. Also publish this sensor's pressure reading to environment.outside.pressure — the SignalK-standard path other plugins (e.g. barometer trend) expect — in addition to its own environment.<zone>.pressure. Only sensors capable of measuring pressure (e.g. RuuviTag) are listed here; the device must also be added as a registered sensor below to actually be read.",
        enum: hasPressureCapable ? ["", ...pressureCapable.map((d) => d.mac)] : [""],
        enumNames: hasPressureCapable
          ? ["(none)", ...pressureCapable.map(formatDeviceLabel)]
          : ["No pressure-capable sensors detected yet"],
      },
      sensors: {
        type: "array",
        title: "Registered sensors",
        description:
          "Sensors to publish to SignalK. Only devices already recognised as a supported sensor type appear in the dropdown below — after installing, give the plugin a minute or two to run (with the sensor in Bluetooth range) and then reopen this configuration page.",
        items: {
          type: "object",
          title: "Sensor",
          required: ["mac"],
          properties: {
            mac: {
              type: "string",
              title: "Device",
              enum: hasKnown ? known.map((d) => d.mac) : [""],
              enumNames: hasKnown ? known.map(formatDeviceLabel) : ["No recognised sensors detected yet"],
            },
            name: {
              type: "string",
              title: "Name override",
              description:
                "Used as the SignalK $source and in generated sensor paths. Defaults to the device's advertised name if it has one, otherwise its sensor type (e.g. 'SwitchBot Meter') — worth setting explicitly.",
            },
            zone: {
              type: "string",
              title: "Zone / location",
              description:
                "Used in environment.<zone>.* paths, e.g. 'cabin', 'engine', 'fridge'. Dots nest into sub-paths, e.g. 'inside.mainCabin' becomes environment.inside.mainCabin.*.",
              examples: ["inside", "outside", "galley", "fridge", "cabin", "engine", "deck", "cockpit", "inside.mainCabin"],
            },
            enabled: { type: "boolean", title: "Enabled", default: true },
          },
        },
      },
    },
  };
}
