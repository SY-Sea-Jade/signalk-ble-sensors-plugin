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
              // adv.name is frequently blank for these sensors — SwitchBot and RuuviTag
              // decode entirely from manufacturer/service data and don't depend on the
              // BLE advertised name, which many providers never surface anyway (it's
              // typically only present in a scan response, not the primary advertising
              // packet). Drop the name segment rather than showing a literal placeholder.
              enumNames: hasKnown
                ? known.map((d) => (d.name ? `${d.name} — ${d.sensorTypeName} (${d.mac})` : `${d.sensorTypeName} (${d.mac})`))
                : ["No recognised sensors detected yet"],
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
