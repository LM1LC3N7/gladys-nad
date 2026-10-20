# NAD for Gladys

Control your **NAD** amplifiers and receivers that have a network control
port (T 758, T 778, T 787, C 338, C 368, C 658, M10…) from Gladys, locally,
without any cloud: power on, standby, volume (capped), mute and source.

> **Important.** This integration has never been tested with a real device:
> it was written from the `nad_receiver` library (the one Home Assistant
> uses) and tested against a fake device only. Your feedback is welcome.
> Unofficial integration, not affiliated with NAD Electronics.

## Setup

1. Connect the device to your network and give it a **fixed IP address** in
   your router (reserved DHCP lease).
2. On the device, enable the **network standby** (or "IP control" / "network
   control", depending on the model), so it still answers in standby and can
   be woken up.
3. In Gladys, install the **NAD** integration, then open its configuration.
4. Type the IP addresses, separated by commas (for example
   `192.168.1.50, 192.168.1.51`). The control port is 23 (telnet); for
   another one, add it: `192.168.1.50:53`.
5. Choose the **volume cap** in dB (-20 dB by default) and, if you want, the
   lowest volume (-80 dB by default).
6. The devices appear in the **Discovery** tab: create them.

The integration keeps one connection open with each device: changes made on
the device or its remote show in Gladys right away. The states are also read
again every minute.

Only the network port is supported: the **RS-232 serial port** is not (a
Gladys integration runs in a container without serial port access).

## What you get

| Feature  | Gladys type                | Note                                               |
| -------- | -------------------------- | -------------------------------------------------- |
| Power    | binary state (read only)   | 1 on, 0 in standby or unreachable                  |
| Power on | button                     | `Main.Power=On`                                    |
| Standby  | button                     | `Main.Power=Off`                                   |
| Volume   | music / volume (0 to 100)  | 0 % = lowest volume, 100 % = the cap               |
| Mute     | button (television / mute) | each press reads the state, then sets the opposite |
| Source   | dropdown                   | the inputs of the device; the list only grows      |

On purpose, no **switch**: an "everything off" or "everything on" from a
voice assistant or a scene neither wakes nor cuts your amplifier.

## Volume cap

NAD devices count their volume in dB (for example -35 dB). In Gladys, the
volume goes from 0 to 100 %: 0 % is the lowest volume of the configuration
(-80 dB by default), 100 % is the **cap** (-20 dB by default). Gladys
(dashboard, scene, voice assistant) can never set a volume above the cap. The
cap is read again just before sending: a new value saved applies at once.

The volume set on the device itself (knob, remote) is not changed by the
integration (above the cap, Gladys shows 100 %), except in the two cases
where Gladys would make it heard:

- **Unmute**: when the volume of the device is above the cap, it is set to
  the cap first, then the mute is removed. When the volume cannot be read,
  nothing is sent.
- **Power on**: after the wake-up, the volume is read again and set to the
  cap when above it. When the device is slow to wake up, the integration
  checks again a few times for about 15 seconds; after that the volume is not
  corrected.

## Sources

The inputs are numbers (1, 2, 3…). Their names are read from the device when
it tells them (`Source1.Name`…); otherwise, type them in the configuration,
for example `1=CD, 2=Tuner, 3=TV`. An input the device switches to is added
to the list.

## Commands

Every command is answered within 4 seconds (Gladys waits 5 seconds). A
command that left for the device without confirmation is reported "sent,
without confirmation"; the line written by the device then shows what it
did. A command that could not leave is reported "nothing sent": so is any
command, Standby included, to a device that is not connected. **Standby**
goes before every command waiting, and cancels a Power on still waiting.

## Reconnection

A device that does not answer (off, network standby disabled, unplugged)
shows its power at 0 and is named in the integration status. The integration
connects again after 10 s, then at intervals doubled after each failure, up
to 5 minutes. Two polls in a row without an answer close the connection,
then the same spaced reconnection applies.

## Configuration button

- **Check the devices**: the connection, power, volume (in dB), mute and
  source of each device, and the volume range in force.

## Data and privacy

The integration asks for no account and no password: the NAD control port
has none. It keeps in `/data/nad.json` the list of the known devices
(address, model, sources). Nothing leaves your local network.

## Known limits

- One zone (the main one); no tuner, speakers A/B, dimmer, sleep or listening
  mode.
- Some models (for example the C 356BEE) cannot report or set an absolute
  volume, only step it: the volume stays unknown there.
- The binary protocol of the D 7050 / D 3045 (port 50001) is not supported.
- Home Assistant uses port 53 by default for this protocol, `nad_receiver`
  port 23: if your device does not answer on 23, try `:53`.
- Never tested with a real device: the real answers may differ.
