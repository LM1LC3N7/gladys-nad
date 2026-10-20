# TODO — NAD v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local control** (2026-10-20): devices added by IP
      address (port 23 by default), one persistent TCP connection per address
      with pushed lines, a poll a minute and spaced reconnection; power state,
      power on, standby, volume mapped onto a dB range whose top is the cap,
      mute, source dropdown; "Check" button; docs en/fr. Tested against a fake
      device on the loopback interface only, never with a real device. The
      store validator could not be run from the development session (no
      access to it there): to run before the first release.
- [ ] **Milestone 2 — real devices** (testers with a T 7x8, C 3x8, C 658 or
      M10). To check first:
  - the port (23 as nad_receiver, 53 as the Home Assistant default) and
    whether a device accepts more than one client;
  - what is sent on connection (banner, telnet negotiation, settings dump);
  - the answers in standby (only `Main.Power`?) and whether `Main.Power=On`
    is answered before the device is ready;
  - the `Main.Volume` format (integer, `.5`, `dB` suffix) and its range per
    model, and the models without an absolute volume (C 356BEE);
  - whether `Main.Source` is a number on every model, and `SourceN.Name?`
    (and `SourceN.Enabled?`) support;
  - the rendering on the Gladys dashboard (not checked here): the
    `television/volume-mute` press, the two `button/push`, the
    `unknown/binary` power and the `text/select` source.
- [ ] **Milestone 3 — more**: volume up/down buttons (`Main.Volume+`/`-`,
      for the models without an absolute volume, still capped by reading the
      volume back), `SourceN.Enabled` to hide the disabled inputs, zone 2,
      the D 7050 / D 3045 binary protocol (port 50001) if testers ask.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: gladhorn/nad_receiver 0.4.0 (MIT, formerly joopert/nad_receiver,
  2026-07-29, the library of the Home Assistant NAD integration) is Python,
  so its telnet protocol (`\n<command>\r`, answers `Key=Value`, `?` and `=`
  operators), command names and volume parsing are ported to JavaScript
  (`src/nad/`); MIT notice in `THIRD_PARTY_NOTICES.md`, copied into the
  image. **TCP/telnet only**: its RS-232 serial transport is not ported (no
  serial port in a Gladys container), nor its `NADReceiverTCP` binary
  protocol of the D 7050 (milestone 3 if asked). No runtime dependency
  besides the SDK (`node:net`).
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1.
- Identity: the protocol gives no serial number (`Main.Model` and
  `Main.Version` are not unique), so the platform id is the address:
  `gladys.externalIds('nad', '<host>')`, `<host>_<port>` when the port is not
  23 (`_` never appears in a host name: two addresses never share an id). The
  docs ask for a fixed IP address. A created device unknown to `/data` (file
  reset) is found again from its external id, and its source options from
  the created device. A known device that is neither typed nor created is
  forgotten (not when the created devices could not be read).
- Feature keys are frozen: `power`, `power_on`, `standby`, `volume`, `mute`,
  `source`. Every publication carries the full, fixed feature list; only the
  source options grow (merged with the `supported_options` of the created
  device).
- **Power: read-only state + two `button/push` ("Power on", "Standby"), not a
  `switch`** (lesson of lot 6: an "everything on / off" must neither wake nor
  cut an amplifier). `Main.Power=On` / `Main.Power=Off`. Power 0 also when the
  device does not answer after a failed connection attempt, not on a simple
  drop. Standby on a device that is not connected is an error ("nothing
  sent"), never a success: "already in standby" would be a guess.
- **Standby is protective, never blocked**: it skips the device queue, goes
  first on the connection (after the one exchange already written, at most
  `requestTimeout` or the rest of a command budget), cancels a Power on still
  queued ("Cancelled by Standby, nothing sent") and the volume checks after a
  wake-up, and no check chain starts for a Power on pressed before it.
  (Review 1, B1) A Power on whose task already runs but whose line still
  waits on the connection (behind a poll query) is dropped too: `exchange`
  takes `shouldSend`, asked again in `pump()` right before `onSent` and the
  write; Power on passes "no Standby asked since my request" and is then
  answered "Cancelled by Standby, nothing sent" (CANCELLED). Its volume check
  after the wake-up stops the same way.
- **Volume cap** (brief: "volume plafonné par option"): the device counts in
  dB; Gladys shows 0..100 % mapped linearly onto `min_volume_db` (-80 dB by
  default, -99..-21) .. `max_volume_db` (-20 dB by default, -80..0), as Home
  Assistant maps its volume level between `min_volume` and `max_volume`
  (default -20 dB too). 100 % is the cap: no command of Gladys can exceed it
  (`percentToDb` clamps, then `Math.min(cap)` again). Both options are read
  inside the queued task, just before the line leaves. The bottom is kept at
  least 10 dB under the cap. The cap option itself never goes above 0 dB. The
  feature range stays 0..100 (frozen at creation: changing the range never
  changes the device structure; the meaning of a percentage does change,
  said in the docs). A volume above the cap shows 100 %, its dB value in
  "Check". A volume set on the device itself above the cap is not lowered,
  except by the two commands of Gladys that would make it heard (as
  gladys-cambridge-audio): unmute (the volume read again first; above the
  cap, `Main.Volume=<cap>` then `Main.Mute=Off`; unknown: refused, nothing
  sent) and Power on (`Main.Power?` and `Main.Volume?` read again after the
  wake-up, lowered when above; when the device cannot tell yet, checked again
  every 2.5 s, 6 times at most, through the device queue; the ack of Power on
  never depends on it). Volumes are sent as integer dB. (Review 1, I2) The
  lowering counts only when the device confirms it (I1) and gives back a
  volume at or under the cap: otherwise the unmute is refused ("volume not
  lowered to the cap, mute kept", `Main.Mute=Off` never sent) and the wake-up
  checks go on. (Review 1, M2) For the window of those checks (6 × 2.5 s)
  after a Power on, a `Main.Volume` pushed above the cap (a device applying
  its power-on volume late) is lowered too, through the device queue, one at
  a time per device; Standby ends the window.
- Publication rate (review 1, M3): the grouping delay of a device is
  `publishDelay` × the number of created devices, so all the devices together
  stay near one publication (4 states at most) a second, under the 300 states
  a minute of Gladys, whatever a device pushes (the flood guard closes the
  connection beyond 300 lines in 10 s).
- Volume validated strictly before queueing: an integer 0..100 as a number or
  a string of digits; null, '', booleans, 12.5, '12abc', NaN refused.
- Mute is a push (Gladys sends a press, not a target): `Main.Mute?` read
  again just before (1.5 s at most) and the explicit `On`/`Off` sent, never a
  toggle (`Main.Mute+` is not used). Unknown mute state: nothing sent.
- Source: the inputs are numbers (as Home Assistant's `sources` 1..12). The
  options: names typed in `source_names` (`1=CD, 2=Tuner`, override), then
  the names read with `Source1.Name?` .. `Source12.Name?` on connection
  (stopped at the first miss, 0.8 s each), then any `Main.Source` value seen
  ("Source N" for a number). Only values matching `isSafeValue` (no line
  break, no space, 32 characters) are kept or written back.
- Commands: serialized per device (mute goes before the commands waiting),
  budget 3.5 s from the Gladys request, the waits included; each exchange
  bounded by what is left; a command still queued at its deadline is dropped,
  never sent late. A line that may have reached the device (written, then no
  answer or connection closed) is answered "sent, without confirmation"; a
  device not connected gets "nothing sent". `onSent` marks the exact moment
  the bytes leave.
- One exchange at a time per connection: the answer is matched by its key
  only (the protocol has no request id). A late answer of a query that timed
  out is **not** dropped (unlike gladys-cambridge-audio): a NAD line always
  carries the state of the device when it wrote it, so it is a fresh state;
  dropping it made a device that ignored a query while off unreadable after
  waking up. Such a line answers a query (`?`) of its key. (Review 1, I1) A
  command (`=`) is confirmed **only by a line carrying the value asked**
  (`confirmsSet`: On/Off by `parseOnOff`, dB by `parseDb` within 0.5, a
  source without case): a late answer, a refusal (`Main.Power=On` after
  `Main.Power=Off`) or a pushed change of another value is applied to the
  state but never settles the command, which ends at its deadline as "sent,
  without confirmation".
- Connection: one TCP connection per typed address and per created device,
  kept across reconnections to Gladys (`connected` only clears the status
  cache and `forgetPublishedStates`, then republishes the status, the
  devices and the states). `Main.Power?` must be answered within 1.5 s, else
  "not a NAD device" and the connection is closed. Reconnection after 10 s,
  doubled after each failure up to 5 minutes; the count is only reset by a
  connection that stayed up 60 s. A configuration save or a Discovery scan
  asks for a reconnection, never sooner than 10 s after the last attempt; a
  reconnection to Gladys does not. A poll every 60 s (`Main.Power?`, then
  volume, mute, source), one query at a time so a command waits at most for
  one; two polls in a row without an answer to `Main.Power?` close the
  connection (then spaced reconnection). TCP keep-alive at 30 s. Not
  persisted in /data: no rate limit nor credential to protect, a restart
  starting over at 10 s is wanted.
- Hostile input: the telnet negotiation is refused as Python's telnetlib does
  (DO -> WONT, WILL -> DONT), once per option and 64 options at most, so a
  repeating device never makes this side loop; sub-negotiations skipped. The
  options 10, 13 and 255 are left unanswered (review 1, M1): no LF, CR or 255
  byte is ever written outside the `\n<command>\r` framing. The link uses its
  injected clock and timers everywhere (review 1, M4).
  Lines cut on CR or LF, 256 characters at most (a longer one is dropped up
  to its end, never kept growing), decoded as Latin-1, one anchored
  expression per line (key of 2 to 4 dotted parts, value of 128 printable
  characters), only the known keys applied, values parsed strictly (On/Off,
  dB -120..+30), names cleaned (control and bidi characters) and cut at 64.
  More than 300 lines in 10 s closes the connection. 16 exchanges waiting at
  most, 20 devices, 20 addresses, 24 sources. The device table of `/data` has
  no prototype and keeps an entry only under the id of its own valid address.
- Discovery: no network capture in the manifest; NAD devices announce
  nothing usable for this protocol (the BluOS mDNS service of some models is
  another API). The Discovery scan button republishes the typed devices and
  asks the silent addresses again.
- Publication: grouped per device (at most one `publishChangedStates` per
  second), only the created devices. No `publishSceneEvent`, no energy index.
- Categories and types from the core only (`server/utils/constants.js`):
  `music/volume` (as the core Sonos service), `television/volume-mute` (music
  has no mute type), `text/select`, `button/push`, `unknown/binary`. No unit:
  `DEVICE_FEATURE_UNITS_BY_CATEGORY` lists none for music, television, text,
  button or unknown. Store category `multimedia`.
- Port: 23 as nad_receiver's telnet transport; Home Assistant's default is
  53 (said in the docs: try `:53`). A serial port typed as an address (`COM3`,
  `/dev/ttyUSB0`) is refused as invalid.
- One zone (the main one), as nad_receiver.
