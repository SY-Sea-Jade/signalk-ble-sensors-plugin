"use strict";

// Registry of supported passive-advertisement sensor decoders. Each decoder
// is a pure { id, name, domain, identify(adv), decode(adv) } module — no BLE
// or SignalK dependencies — so they're trivially unit-testable in isolation.
//
// Order matters only where two decoders could otherwise both claim the same
// advertisement; switchbot-th and switchbot-meter-plus share a manufacturer
// ID but are disambiguated by model byte, so ordering isn't load-bearing
// today, but keep more specific identify() checks earlier if that changes.
const decoders = [
  require("./decoders/switchbot-th"),
  require("./decoders/switchbot-meter-plus"),
  require("./decoders/ruuvitag"),
  require("./decoders/xiaomi-atc"),
  require("./decoders/govee"),
];

// Returns the first decoder that claims this advertisement, or null if none
// do — callers should treat null as "no mappable sensor data" and ignore the
// advertisement entirely (e.g. a device only broadcasting RSSI/UUIDs).
function identifySensorType(adv) {
  for (const decoder of decoders) {
    if (decoder.identify(adv)) return decoder;
  }
  return null;
}

module.exports = { decoders, identifySensorType };
