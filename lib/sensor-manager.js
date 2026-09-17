"use strict";

const { normalizeAdvertisement } = require("./ble-advertisement");
const { identifySensorType } = require("./sensor-types");
const { buildDelta, buildMetaDelta, sanitizeZone } = require("./path-mapper");

// The SignalK-spec path other plugins (barometer trend, weather routing,
// etc.) expect for the boat's ambient outside pressure — distinct from this
// plugin's own environment.<zone>.pressure paths, which are keyed by
// whatever zone name the user gave each sensor.
const OUTSIDE_PRESSURE_PATH = "environment.outside.pressure";

// If a registered sensor hasn't been heard from in this long, mark its
// "reachable" path false. Advertisement intervals for these sensors are
// typically a few seconds, so 5 minutes is a generous margin against a
// couple of missed beacons.
const NO_CONTACT_MS = 5 * 60 * 1000;

function normalizeMac(mac) {
  return String(mac).toLowerCase();
}

// Owns the live BLE Manager API subscription and all runtime state: which
// advertised devices have been recognised as a supported sensor type (for
// the config UI's MAC dropdown) and which of those the user has registered
// (for actually publishing SignalK deltas). Talks to app.bleApi and
// app.handleMessage directly, so — like lib/device.js and lib/scanner.js in
// the sibling signalk-bluetti-plugin — it's BLE/SignalK integration glue,
// exercised via the real server rather than unit-tested here; the decoding
// and path-mapping it calls into are deterministic and covered separately.
class SensorManager {
  constructor(app, pluginId, log) {
    this._app = app;
    this._pluginId = pluginId;
    this._log = log;
    this._recognized = new Map(); // normalized mac -> { mac, name, sensorTypeId, sensorTypeName, providesPressure, lastSeen }
    this._configured = new Map(); // normalized mac -> config entry from options.sensors
    this._noContactTimers = new Map(); // normalized mac -> Timeout
    this._metaSent = new Set(); // normalized macs whose units/description meta has been published
    this._unmatchedLogged = new Set(); // normalized macs already debug-logged as unrecognized
    this._outsidePressureSourceMac = null; // normalized mac whose pressure also publishes to environment.outside.pressure
    this._unsubscribe = null;
  }

  configure(options = {}) {
    const sensors = options.sensors || [];
    this._configured = new Map(sensors.filter((s) => s && s.mac).map((s) => [normalizeMac(s.mac), s]));
    this._outsidePressureSourceMac = options.outsidePressureSource ? normalizeMac(options.outsidePressureSource) : null;
  }

  // Devices seen so far that matched a known sensor type — used to populate
  // the config schema's MAC dropdown. Devices with no mappable sensor data
  // never make it into this map (see _onAdvertisement).
  getRecognizedDevices() {
    return [...this._recognized.values()];
  }

  start() {
    if (!this._app.bleApi) {
      throw new Error("BLE Manager API (app.bleApi) is not available on this SignalK server — requires server >= 2.31.0.");
    }
    this._unsubscribe = this._app.bleApi.onAdvertisement(this._pluginId, (adv) => this._onAdvertisement(adv));
  }

  stop() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    for (const timer of this._noContactTimers.values()) clearTimeout(timer);
    this._noContactTimers.clear();
  }

  _onAdvertisement(rawAdv) {
    let adv;
    try {
      adv = normalizeAdvertisement(rawAdv);
    } catch (err) {
      this._log(`Failed to parse advertisement from ${rawAdv && rawAdv.mac}: ${err.message}`);
      return;
    }

    const sensorType = identifySensorType(adv);
    if (!sensorType) {
      this._logUnmatchedOnce(adv);
      return; // no mappable sensor data (e.g. RSSI-only) — ignore
    }

    const normMac = normalizeMac(adv.mac);
    this._recognized.set(normMac, {
      mac: adv.mac,
      name: adv.name,
      sensorTypeId: sensorType.id,
      sensorTypeName: sensorType.name,
      providesPressure: !!sensorType.providesPressure,
      rssi: adv.rssi,
      lastSeen: Date.now(),
    });

    const config = this._configured.get(normMac);
    if (!config || config.enabled === false) return;

    let values;
    try {
      values = sensorType.decode(adv);
    } catch (err) {
      this._log(`Failed to decode ${sensorType.name} advertisement from ${adv.mac}: ${err.message}`);
      return;
    }
    values.rssi = adv.rssi;
    values.reachable = true;

    this._publish(adv, config, sensorType, values);
    this._scheduleNoContactCheck(normMac, adv, config, sensorType);
  }

  // Debug aid for "my sensor isn't showing up in the dropdown": logs the raw
  // manufacturer/service data of a device that broadcasts a payload but
  // doesn't match any decoder's identify(), once per MAC, so a user can
  // enable plugin debug logging and paste the output when filing an issue
  // for an unsupported sensor/firmware variant. Devices with no payload at
  // all (phones, fitness trackers, RSSI-only beacons) are skipped as noise.
  _logUnmatchedOnce(adv) {
    if (adv.manufacturerData.size === 0 && adv.serviceData.size === 0) return;
    const normMac = normalizeMac(adv.mac);
    if (this._unmatchedLogged.has(normMac)) return;
    this._unmatchedLogged.add(normMac);

    const mfg = [...adv.manufacturerData.entries()].map(([id, buf]) => `0x${id.toString(16)}:${buf.toString("hex")}`);
    const svc = [...adv.serviceData.entries()].map(([uuid, buf]) => `${uuid}:${buf.toString("hex")}`);
    this._log(
      `No known sensor type matched ${adv.mac} (name: "${adv.name}"). manufacturerData=[${mfg.join(", ")}] serviceData=[${svc.join(", ")}]`,
    );
  }

  _publish(adv, config, sensorType, values) {
    const name = config.name || adv.name || sensorType.name;
    const zone = config.zone;
    const source = `${this._pluginId}.${sensorType.id}`;

    const normMac = normalizeMac(adv.mac);
    if (!this._metaSent.has(normMac)) {
      const meta = buildMetaDelta({ name, zone, values, source });
      if (meta) {
        this._app.handleMessage(this._pluginId, meta);
        this._metaSent.add(normMac);
      }
    }

    const delta = buildDelta({ name, zone, values, source });

    // Optionally cross-publish this sensor's pressure to the SignalK-spec
    // environment.outside.pressure path (which already has server-provided
    // units metadata, unlike our own environment.<zone>.* paths — no meta
    // delta needed here) so other plugins that expect it there — barometer
    // trend, weather routing — can use it without knowing this plugin's zone
    // naming. Skipped when the sensor's own zone already resolves there, to
    // avoid publishing the identical path twice in one update.
    if (
      this._outsidePressureSourceMac === normMac &&
      typeof values.pressure === "number" &&
      !Number.isNaN(values.pressure) &&
      sanitizeZone(zone) !== "outside"
    ) {
      const outsidePressureDelta = {
        updates: [
          { $source: source, timestamp: new Date().toISOString(), values: [{ path: OUTSIDE_PRESSURE_PATH, value: values.pressure }] },
        ],
      };
      this._app.handleMessage(this._pluginId, outsidePressureDelta);
    }

    if (delta) this._app.handleMessage(this._pluginId, delta);
  }

  _scheduleNoContactCheck(normMac, adv, config, sensorType) {
    const existing = this._noContactTimers.get(normMac);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this._noContactTimers.delete(normMac);
      this._publish(adv, config, sensorType, { reachable: false });
    }, NO_CONTACT_MS);
    timer.unref?.();
    this._noContactTimers.set(normMac, timer);
  }
}

module.exports = SensorManager;
