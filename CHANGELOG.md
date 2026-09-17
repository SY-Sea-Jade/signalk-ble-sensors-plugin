# [0.1.3]

Optionally re-publish a pressure value as `environment.outside.pressure` to cope with IP68 RuuviTag Pro that doesn't capture pressure, and re-use near enough value from an indoor standard RuuviTag.

# [0.1.2]

Improve RuuviTag support, adding motion sensor and removing humidity/pressure where not supported, e.g. the 3in1 or 2in1 RuuviTag Pro models
Fix for SwitchBot (Woan) thermometers that publish payloads with MAC address prefixes
The device RSSI is added to the drop-down list, to help work out which device is which ( e.g. saloon vs deck thermometers ) or even on another boat

# [0.1.1]

Simplify sensor names, and make sure values published with SignalK units.

# [0.1.0]

First alpha release
