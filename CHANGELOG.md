# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- NAD amplifiers and receivers with a network control port (telnet, port 23
  by default), added by IP address, without any cloud. The RS-232 serial port
  is not supported.
- Power state (read only), "Power on" and "Standby" buttons, volume (0 to
  100 %, validated strictly, mapped onto the new `min_volume_db` and
  `max_volume_db` options: 100 % is the cap, -20 dB by default, never
  exceeded), mute (each press reads the mute and sets the opposite) and a
  "Source" dropdown read and set, with names read from the device or typed
  in the new `source_names` option.
- Changes made on the device or its remote are pushed to Gladys (grouped, at
  most once a second per device); the states are also read again every
  minute.
- Unmuting lowers a volume above the cap to the cap first; Power on brings
  the volume back to the cap after the wake-up.
- Standby goes before every command waiting and cancels a Power on still
  waiting. Every command is answered to Gladys within 4 seconds, or dropped,
  never sent late.
- A device that does not answer shows its power at 0 and is named in the
  integration status; it is connected again after 10 s, then at intervals
  doubled up to 5 minutes.
- "Check the devices" button.

### Security

- Lines are bounded (256 characters) and parsed once by an anchored
  expression; only the expected keys are read; a value is written back to the
  device only when it holds no line break nor space; the telnet negotiation is
  refused once per option; a connection flooded with lines is closed. The
  device table of `/data` has no prototype.
