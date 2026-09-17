"use strict";

const { normalizeAdvertisement } = require("./ble-advertisement");
const { identifySensorType } = require("./sensor-types");
const { buildDelta } = require("./path-mapper");

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
    this._recognized = new Map(); // normalized mac -> { mac, name, sensorTypeId, sensorTypeName, lastSeen }
    this._configured = new Map(); // normalized mac -> config entry from options.sensors
    this._noContactTimers = new Map(); // normalized mac -> Timeout
    this._unsubscribe = null;
  }

  configure(sensors = []) {
    this._configured = new Map(sensors.filter((s) => s && s.mac).map((s) => [normalizeMac(s.mac), s]));
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
    if (!sensorType) return; // no mappable sensor data (e.g. RSSI-only) — ignore

    const normMac = normalizeMac(adv.mac);
    this._recognized.set(normMac, {
      mac: adv.mac,
      name: adv.name,
      sensorTypeId: sensorType.id,
      sensorTypeName: sensorType.name,
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

  _publish(adv, config, sensorType, values) {
    const delta = buildDelta({
      mac: adv.mac,
      name: config.name || adv.name || sensorType.name,
      zone: config.zone,
      values,
      source: `${this._pluginId}.${sensorType.id}`,
    });
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
