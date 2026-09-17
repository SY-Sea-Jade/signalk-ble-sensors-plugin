"use strict";

// Normalises a raw BLEAdvertisement from the SignalK server's BLE Manager API
// (app.bleApi.onAdvertisement — see @signalk/server-api's bleapi.d.ts) into the
// shape our sensor decoders expect. manufacturerData/serviceData arrive as
// hex-encoded strings keyed by manufacturer ID / service UUID; decoders work
// against decoded Buffers instead.
function normalizeAdvertisement(adv) {
  const manufacturerData = new Map();
  if (adv.manufacturerData) {
    for (const [key, hex] of Object.entries(adv.manufacturerData)) {
      manufacturerData.set(Number(key), Buffer.from(hex, "hex"));
    }
  }

  const serviceData = new Map();
  if (adv.serviceData) {
    for (const [uuid, hex] of Object.entries(adv.serviceData)) {
      serviceData.set(uuid.toLowerCase(), Buffer.from(hex, "hex"));
    }
  }

  const serviceUuids = (adv.serviceUuids || []).map((u) => u.toLowerCase());

  return {
    mac: adv.mac,
    name: adv.name || "",
    rssi: adv.rssi,
    manufacturerData,
    serviceData,
    serviceUuids,
  };
}

module.exports = { normalizeAdvertisement };
