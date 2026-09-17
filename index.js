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
    return buildSchema(recognized);
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
    manager.configure(options.sensors);

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

function buildSchema(recognized) {
  const known = recognized.slice().sort((a, b) => a.mac.localeCompare(b.mac));
  const hasKnown = known.length > 0;

  return {
    type: "object",
    properties: {
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
              enumNames: hasKnown
                ? known.map((d) => `${d.name || "(unnamed)"} — ${d.sensorTypeName} (${d.mac})`)
                : ["No recognised sensors detected yet"],
            },
            name: {
              type: "string",
              title: "Name override",
              description: "Used as the SignalK $source and in generated sensor paths. Defaults to the device's advertised name.",
            },
            zone: {
              type: "string",
              title: "Zone / location",
              description: "Used in environment.<zone>.* paths, e.g. 'cabin', 'engine', 'fridge'.",
              examples: ["inside", "outside", "galley", "fridge", "cabin", "engine", "deck", "cockpit"],
            },
            enabled: { type: "boolean", title: "Enabled", default: true },
          },
        },
      },
    },
  };
}
