# signalk-ble-sensors-plugin

ALPHA

Passive BLE sensor listening for [SignalK](https://signalk.org/) — reads temperature, humidity and battery data broadcast by cheap, popular BLE sensors and republishes it to SignalK paths, without ever opening a Bluetooth connection to the device. Relies only on _BLE Manager_, so requires SignalK v2.31 or above.

## How it works

Sensors like these broadcast their readings in plain BLE advertisement packets a few times a second. This plugin listens to that broadcast stream through the SignalK server's **BLE Manager API** and decodes it — there's no pairing, no GATT connection, and no battery drain on the sensor from being connected to.

Devices the plugin doesn't recognise (anything not in the supported list below — a phone, a fitness tracker, or a sensor type not yet supported) are ignored entirely; only useful advertisements from a recognised sensor type are ever surfaced, so there's noise from unknown devices reporting their Bluetooth signal strength.

## Requirements

- SignalK server **>= 2.31.0** with the BLE Manager enabled (Server → Bluetooth in the admin UI) and at least one BLE provider available — the server's own local Bluetooth adapter support is enough, or a BLE proxy.
- No other dependencies. This plugin never talks to Bluetooth hardware directly.

## Supported sensors

| Sensor                                           | Notes                                                  |
| ------------------------------------------------ | ------------------------------------------------------ |
| SwitchBot Meter (WoSensorTH)                     | Actively used, well tested                             |
| SwitchBot Meter Plus                             | Actively used, well tested                             |
| RuuviTag (data format 5)                         | Actively used, well tested                             |
| Xiaomi LYWSD03MMC (pvvx/atc1441 custom firmware) | Best-effort — not actively used, contributions welcome |
| Govee H5074 / H5075                              | Best-effort — not actively used, contributions welcome |

Stock Xiaomi firmware (encrypted, not the ATC/pvvx custom firmware above) isn't supported. Sensors that need a GATT connection to read (Victron, Renogy, most BMS chips, etc.) are out of scope for this plugin. Many of these already have plugins, such as [signalk-bluetti-plugin](https://github.com/rhizomatics/signalk-bluetti-plugin) or [signalk-victron-ble](https://github.com/stefanor/signalk-victron-ble).

## Configuring a sensor

1. Install and enable the plugin, then restart (or just start) the SignalK server.
2. Make sure the sensor is powered on and within Bluetooth range for a minute or two.
3. Open the plugin's configuration page and click **+ Add Item** under "Registered sensors".
4. Pick the sensor from the **Device** dropdown — it lists every recognised sensor the plugin has seen, labelled with its advertised name, sensor type, and MAC address. If it's not there yet, close the page, wait a bit longer, and reopen it.
5. Fill in a **Zone / location** (e.g. `cabin`, `fridge`, `engine`) — this becomes part of the SignalK path (`environment.<zone>.temperature`, etc.) — and optionally a **Name override**.
6. Save. Readings should start appearing within a few seconds.

## Published paths

| Value            | Path                                    | Unit                                |
| ---------------- | --------------------------------------- | ----------------------------------- |
| Temperature      | `environment.<zone>.temperature`        | K                                   |
| Humidity         | `environment.<zone>.humidity`           | ratio (0-1)                         |
| Battery strength | `sensors.<name>_<mac>.battery.strength` | ratio (0-1), with low-battery zones |
| Battery voltage  | `sensors.<name>_<mac>.battery.voltage`  | V                                   |
| Signal strength  | `sensors.<name>_<mac>.RSSI`             | dB                                  |
| Reachable        | `sensors.<name>_<mac>.reachable`        | boolean                             |

These path and unit conventions are reused from
[bt-sensors-plugin-sk](https://github.com/naugehyde/bt-sensors-plugin-sk) so this plugin's output lines up with dashboards or alarms already built against that plugin's paths.

## Relationship to bt-sensors-plugin-sk

[bt-sensors-plugin-sk](https://github.com/naugehyde/bt-sensors-plugin-sk) is the more complete, actively maintained BLE sensor plugin for SignalK, supporting many more sensors including ones that need a GATT connection. It doesn't yet have support for the BLE Manager, so can suffer the same issues as other dedicated Bluetooth plugins. This plugin exists to cover the gap in the meantime for a narrower set of passive, advertisement-only sensors, and is expected to be retired once that support lands upstream.
