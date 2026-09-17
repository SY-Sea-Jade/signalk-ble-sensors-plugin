# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install               # install dependencies (none beyond dev tooling — no BLE library required)
npm test                  # run the test suite (node:test, no extra deps)
npm run test:coverage     # same, plus coverage report with 80% line/branch/function thresholds
npm run lint              # oxlint
npm run fmt:check         # oxfmt --check
```

There is no build step. The plugin is loaded by the SignalK server from `index.js`.

Tests live in `test/*.test.js` and cover the entire deterministic core: `lib/ble-advertisement.js`,
`lib/sensor-types.js`, `lib/path-mapper.js`, and every module in `lib/decoders/`. `lib/sensor-manager.js`
is BLE Manager API integration glue (owns the live `app.bleApi` subscription and calls `app.handleMessage`)
and is excluded from the coverage target for the same reason `lib/device.js`/`lib/scanner.js` are excluded
in the sibling `signalk-bluetti-plugin`: it's exercised against the real server rather than mocked.

To exercise the plugin locally, install it into a running SignalK server:

```bash
cd ~/.signalk/node_modules && ln -s /path/to/signalk-ble-sensors-plugin signalk-ble-sensors-plugin
```

The server must be >= 2.31.0 with a BLE provider registered (a local BlueZ adapter is enough — the
server's own BLE Manager supplies one by default) since this plugin only talks to `app.bleApi`, never
to Bluetooth hardware directly.

## Architecture

This plugin passively listens to BLE advertisements for a fixed set of known sensor models and republishes
their readings to SignalK. It never opens a GATT connection and never scans/discovers on its own — all
Bluetooth access goes through the SignalK server's BLE Manager API (`app.bleApi`, server >= 2.31.0,
`@signalk/server-api`'s `bleapi.d.ts`), which multiplexes advertisements from whatever BLE provider(s) the
server has configured. This is a deliberate, permanent scope choice (see "Why BLE-Manager-only" below), not
a placeholder for GATT support.

### Data flow

```
app.bleApi.onAdvertisement()  — merged advertisement stream, all providers
  → lib/ble-advertisement.js   (hex-decode manufacturerData/serviceData into Buffers)
    → lib/sensor-types.js      (identify(): which decoder, if any, claims this advertisement)
      → lib/decoders/*.js      (decode(): typed sensor values from the raw advertisement bytes)
        → lib/path-mapper.js   (resolve SignalK paths, build delta)
          → app.handleMessage()
```

`lib/sensor-manager.js` is the only module that touches `app.bleApi`/`app.handleMessage`; it wires the
above pipeline together and owns two pieces of runtime state:

- **Recognized devices** — every MAC whose advertisement has ever matched a decoder's `identify()`, kept
  in memory so the plugin's config schema can offer them in a dropdown (see "Config screen" below).
  A device that never matches any decoder (e.g. a phone, a fitness tracker, anything only broadcasting
  RSSI/UUIDs with no sensor payload we understand) is never added here and is otherwise ignored entirely —
  this is the "ignore devices with no mappable sensor data" behavior.
- **Configured sensors** — the subset of recognized MACs the user has registered via the config screen.
  Only these get republished to SignalK; recognizing a device doesn't publish anything on its own.

Each registered sensor also gets a simple no-contact watchdog: if no advertisement arrives for
`NO_CONTACT_MS` (5 minutes — several times the typical multi-second advertisement interval for these
sensors), its `reachable` path is set `false`.

### Module responsibilities

- **`index.js`** — Plugin lifecycle (`start`/`stop`) and config schema. `plugin.schema` is a function (not
  a static object) so the server re-evaluates it — and picks up newly recognized devices — every time the
  config UI is opened; see "Config screen" below. Errors if `app.bleApi` isn't present (server < 2.31.0 or
  no BLE provider registered) rather than falling back to any direct-hardware path.

- **`lib/ble-advertisement.js`** — Normalizes a raw `BLEAdvertisement` from the BLE Manager API into the
  shape decoders expect. The API's `manufacturerData`/`serviceData` arrive as hex-encoded strings keyed by
  manufacturer ID / service UUID (not Buffers) — this is the one place that hex-decodes them.

- **`lib/sensor-types.js`** — The decoder registry. `identifySensorType(adv)` returns the first decoder
  whose `identify()` claims the advertisement, or `null`.

- **`lib/decoders/*.js`** — One module per sensor model/family, each a pure `{ id, name, domain, identify(adv),
decode(adv) }` with no BLE or SignalK dependencies (trivially unit-testable against synthetic buffers).
  Currently: `switchbot-th` (SwitchBot Meter / WoSensorTH), `switchbot-meter-plus` (SwitchBot Meter Plus),
  `ruuvitag` (RuuviTag data format 5), `xiaomi-atc` (Xiaomi LYWSD03MMC running the pvvx/atc1441 custom
  firmware), `govee` (Govee H5074/H5075). SwitchBot and RuuviTag are the actively-used/best-tested pair;
  the rest are best-effort community coverage.

- **`lib/path-mapper.js`** — SignalK path templates, units, and battery-low zones, plus the `{zone}`/
  `{sensorId}` substitution and delta-building logic. The path/unit conventions themselves (e.g.
  `environment.{zone}.temperature` in Kelvin, `sensors.{sensorId}.battery.strength` as a 0-1 ratio with
  low-battery zones) are reused from
  [bt-sensors-plugin-sk](https://github.com/naugehyde/bt-sensors-plugin-sk)'s `plugin_defaults.json` so
  this plugin's output lines up with dashboards/alarms built against that plugin's conventions — but none
  of its code, dependencies, or GATT/connection-based sensor support were carried over. `{sensorId}` is
  just the sensor's `name`, sanitized and lowercased (no MAC) — `buildMetaDelta()` publishes a one-time
  SignalK `meta` update per sensor (units/description/zones from `FIELD_PATHS`) alongside the first
  `values` delta, since plugin-defined paths like these have no built-in SignalK-spec metadata and
  without it webapps show raw numbers (e.g. a temperature of `287.04` with no indication it's Kelvin)
  instead of converting/labelling them.

- **`lib/sensor-manager.js`** — BLE Manager API integration glue: owns the `app.bleApi.onAdvertisement()`
  subscription, the recognized/configured device maps, the no-contact watchdog, and calls
  `app.handleMessage()`. See "Data flow" above.

### Config screen

The config UI is a single array field (`sensors`), so the standard SignalK plugin-config form's native
"+ Add Item" button is how a sensor gets registered — there's no custom webapp/React panel here. Each
array item's `mac` field is a `enum`/`enumNames` dropdown built from `sensor-manager`'s recognized-devices
map (label: `<name> — <sensor type> (<mac>)`); it's populated live because `plugin.schema` is a function,
not a static object, so every time the admin UI fetches the schema it reflects whatever the plugin has
seen since it started. This means a sensor must actually be observed at least once (plugin running, sensor
in Bluetooth range) before it can be selected — the schema's `description` says so, and if nothing's been
seen yet the dropdown falls back to a single disabled-looking placeholder entry (an empty `enum` array is
invalid JSON Schema).

A registered sensor's `zone` (used in `environment.<zone>.*` paths) and `name` (used as `$source` and,
sanitized/lowercased, in `sensors.<name>.*` paths — so two registered sensors sharing a name will collide
on these paths) are free-text fields the user fills in after picking the MAC — the plugin
doesn't try to infer either.

### Why BLE-Manager-only

Unlike `signalk-bluetti-plugin` (this repo's sibling, which owns a direct BlueZ D-Bus connection because it
needs a stateful GATT session per device), this plugin only ever reads advertisement broadcasts, which the
BLE Manager API already merges from every registered provider. There's no reason to duplicate that with a
second, direct BlueZ scan path — it would just mean two things racing to open the adapter. This is a
different tradeoff than the bluetti plugin's `useBleManagerApi` opt-in (which defaults off pending a known
BlueZ GATT-resolution race in the server's local provider): that race is a GATT concern, and this plugin
never opens a GATT connection at all.

### Relationship to bt-sensors-plugin-sk

[bt-sensors-plugin-sk](https://github.com/naugehyde/bt-sensors-plugin-sk) already supports a much larger
set of sensors (including GATT-connected ones like Victron and various BMS chips) and is adding BLE Manager
API support of its own (see its issue #190). This plugin exists because that support isn't there yet and a
narrower, passive-only, BLE-Manager-only plugin was needed sooner; it's expected to be superseded once
upstream lands BLE Manager support, at which point maintaining a separate plugin stops making sense.
