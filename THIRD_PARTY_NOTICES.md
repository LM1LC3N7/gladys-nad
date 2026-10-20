# Third-party notices

This integration ports to JavaScript the logic of the following project: the
NAD ASCII control protocol over the network (`\n<Domain>.<Function>?\r` to
read, `=` to set, answers and pushed changes `<Domain>.<Function>=<value>`),
the command names (`Main.Power`, `Main.Volume`, `Main.Mute`, `Main.Source`,
`Main.Model`), the reading of the volume in dB (the leading number only), the
line some firmwares send on connection (`Main.Model=…`, read here as any other
line), and the telnet port 23 (`src/nad/`). Only its telnet transport is ported: its RS-232 serial
transport and the binary protocol of the D 7050 (`NADReceiverTCP`) are not.
Nothing of it is installed at runtime; its notice is reproduced below.

## nad_receiver 0.4.0

<https://github.com/gladhorn/nad_receiver> (formerly joopert/nad_receiver,
the library behind the Home Assistant NAD integration), version 0.4.0 of
2026-07-29

```
MIT License

Copyright (c) 2016 joopert

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant, NAD integration

<https://github.com/home-assistant/core/tree/dev/homeassistant/components/nad>
(Apache License 2.0): only consulted, no code copied. Its mapping of the
volume between a lowest and a highest dB value, its default highest value
(-20 dB, the cap here) and its source names by input number (1 to 12) are
reused as facts.

## LM1LC3N7/gladys-cambridge-audio

The structure of the app, the command queue and budget, the volume cap on
unmute and power on, the `/data` store and the handler wiring follow this
integration of the same author, under the Apache License 2.0 of this
repository.
