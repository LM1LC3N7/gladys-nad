# gladys-nad

[Gladys Assistant](https://gladysassistant.com) external integration for
**NAD** amplifiers and receivers with a network control port (T 758, T 778,
T 787, C 338, C 368, C 658, M10…), on the local network: power on, standby,
volume (capped by an option), mute and source, through the NAD ASCII control
protocol over TCP (telnet, port 23), without any cloud. The RS-232 serial
port is not supported. Unofficial, not affiliated with NAD Electronics.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against a fake device only,
> never with a real NAD device.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (NadApp)
                                   ├─ src/nad/link.js      one address: TCP connection, snapshot, pushed lines, poll, spaced reconnection
                                   ├─ src/nad/protocol.js  commands, lines, telnet filter (ported, untrusted input)
                                   ├─ src/model.js         known devices -> Gladys devices and states (pure)
                                   ├─ src/config.js        addresses, volume range (dB <-> %), source names
                                   └─ src/store.js         /data/nad.json: known devices, their sources
```

- **Devices** are added by IP address (configuration): the protocol gives no
  serial number, so the address is the identity (external id
  `nad:<host>`, or `nad:<host>_<port>` for a port other than 23). A created
  device unknown to `/data` is found again from its external id.
- **One TCP connection per address**, kept open: on connection
  `Main.Power?` must be answered (else "not a NAD device"), then the model,
  volume, mute, source and source names (`Source1.Name?`…, stopped at the
  first miss) are read. Every line the device writes is merged and published
  (grouped, at most once a second per device). A poll every minute; two polls
  in a row without an answer to `Main.Power?` close the connection.
  Reconnection after 10 s, then doubled after each failure up to 5 minutes;
  the count is only reset by a connection that stayed up one minute.
- **One exchange at a time** per connection (the answer is matched by its
  key), each with a deadline counted from its request: an exchange that
  cannot be written in time is never written late.
- **Commands**: validated first (volume an integer 0..100, source among the
  dropdown options and safe to write), serialized per device, each within a
  3.5 s budget (Gladys acks in 5 s). The volume is mapped onto
  `min_volume_db`..`max_volume_db`, read just before sending: 100 % is the
  cap, never exceeded. Mute is a press: the state is read just before and the
  explicit value sent; unmuting (and Power on) first brings a volume above the
  cap back to it. Standby skips the device queue, goes first on the
  connection and cancels a Power on still waiting. A line that may have
  reached the device is reported "sent, without confirmation".
- **Features**: `music/volume`, `television/volume-mute`, `text/select`
  (source), `button/push` (power on, standby) and a read-only
  `unknown/binary` power state. No switch, no unit.
- **Bounded input**: telnet negotiation refused (once per option), lines of
  256 characters at most (longer ones dropped), one anchored expression per
  line, values parsed strictly, 16 exchanges waiting at most, a connection
  flooded with more than 300 lines in 10 s is closed.

## Development

```bash
npm install
npm test                                        # node --test, loopback only (fake device)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fakeNad.js` is a fake NAD device on 127.0.0.1 (queries,
settings, pushed lines, telnet negotiation, silent, slow and standby modes).
The end-to-end tests run the real handlers against the SDK's fake Gladys.

## Credits

- [`nad_receiver`](https://github.com/gladhorn/nad_receiver) 0.4.0 (MIT,
  joopert), the library behind the Home Assistant NAD integration: the
  protocol and the commands are ported from its telnet transport to
  JavaScript.
- The Home Assistant NAD integration (Apache-2.0) was consulted for the
  volume mapping in dB, the default cap and the source numbers.
- The app structure follows
  [LM1LC3N7/gladys-cambridge-audio](https://github.com/LM1LC3N7/gladys-cambridge-audio)
  (same author, Apache-2.0).

NAD is a trademark of its owner, used here only to name the compatible
products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (nad_receiver, MIT):
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
