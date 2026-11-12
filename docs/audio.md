# Microphone capture

How the helper records the microphone, and what main sees.

## Flow

- Holding the dictation key starts a session (`audio.start`); releasing it stops it (`audio.stop`). Main runs starts and stops one after the other, so a quick tap never reaches the helper out of order.
- **Audio never crosses the protocol.** The helper converts the default input to 16 kHz mono, applies gain and a limiter, and writes signed 16-bit little-endian PCM (no header) to `~/Library/Application Support/Murmur/audio/tmp/<sessionId>.pcm`. `MURMUR_AUDIO_DIR` overrides the folder in development.
- Main gets `audio.level` events (about 10 per second), one `audio.silent` event if the first 3 seconds stay below -55 dBFS, and the file reference with duration, sample count and levels when the session stops.
- `audio.cancel` ends a session and deletes its file. Files in the temporary folder older than 24 hours are deleted when a new session starts. Keeping audio for history is issue #12.
- One session at a time; a second start gets `BUSY`. Only the system default input is used; device choice comes later.

Types and schemas: `packages/shared/src/audio.ts`. Example messages: `packages/shared/protocol-fixtures/audio.capture.json`.

## Processing (provisional values)

| Step     | Rule                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Resample | AVAudioConverter from the device rate to 16 kHz; channels are averaged to mono                                                          |
| Gain     | Speech below -40 dBFS is raised towards -40 dBFS, by at most +24 dB. Blocks below -55 dBFS count as background and do not move the gain |
| Limiter  | Instant attack, 50 ms release, ceiling -1.1 dBFS, so loud speech never clips                                                            |
| Silence  | If no 100 ms window in the first 3 s is above -55 dBFS before gain, `audio.silent` is sent once with the device name                    |

The gain rule is tuned later with quiet-speech recordings (whisper mode raises the ceiling to +30 dB).

## Microphone permission

The helper only reads the permission. If it is not granted, `audio.start` fails with `PERMISSION_DENIED` before the microphone is touched, so no system prompt appears, and main logs that nothing was recorded. Grant it from the Hub's Settings (see [permissions.md](permissions.md)); in development it belongs to the terminal or the Electron binary.

## Manual test

1. `npm run build:helper`, then `npm run dev`. Microphone and Input Monitoring granted to the app that runs the dev build.
2. Hold Right Option, speak for about 10 seconds, release. The terminal shows `[audio] recording from <your mic>`, then `[audio] captured 10.0x s (about 160000 samples at 16 kHz) … about 100 level events`.
3. Mute the input (or turn the input volume to zero in System Settings, Sound), hold Right Option for 4 seconds: `No sound from <your mic>` appears about 3 seconds in.
4. Tap Right Option quickly several times: each tap logs one start and one stop, in order, with no `BUSY`.

## Plugging microphones in and out

The helper listens to Core Audio for changes to the device list and the default input, and
to the audio engine for configuration changes (for example a Bluetooth headset switching
to its call profile). Changes come in bursts, so it acts 0.3 s after the last one.

- **Always:** it sends `audio.devices.changed` with the new list. The tray menu updates at
  once; Settings shows the new list the next time it opens.
- **While idle:** nothing else happens. The next recording uses the chosen microphone, or
  the system default under Auto, so a newly plugged-in default is picked up then.
- **While recording:** a newly connected device never interrupts the recording. If the
  device in use is removed, or capture stops by itself, recording continues into the same
  file: on the chosen microphone if it is still there, otherwise on the system default. The
  helper sends `audio.route.changed` (`device-removed` or `interrupted`) and the Bar says
  "Microphone changed. Continuing with ..." once per recording. If no input is left, the
  recording keeps what it had and the Bar says the microphone went away.

### Manual test

1. Plug in a USB microphone or connect a headset while Murmur is idle: the tray's
   Microphone menu lists it without a restart.
2. Choose it, start a hands-free recording, speak, unplug it, keep speaking, then stop.
   The Bar says the microphone changed; the text contains both parts; the log shows
   `audio input changed (device-removed)`.
3. With AirPods as the input, start a recording and play a video so the headset changes
   profile: the log shows `interrupted` and the recording carries on.

## Automatic microphone choice

With "Automatic" (stored as `auto`), main asks the helper for the devices and the lid state
(`audio.devices` now also returns `lidClosed`, true, false or null without a lid) at each start
of a dictation, microphone check or pronunciation clip, with a 300 ms limit:

- Virtual inputs (transport `virtual`, which includes aggregate devices, or a known loopback
  name such as BlackHole or Loopback) are never chosen over a real microphone.
- While the lid is closed, the built-in microphone is skipped.
- If the system default passes both checks, it is used as before. Otherwise the best real
  device is used: USB, then Bluetooth, then other, then built in. With none left, the system
  default is used anyway.

Opening the lid again counts from the next dictation. The log says when the choice changes
(`Auto uses Desk Mic (lid closed)`). A device chosen by name in Settings is always used as is.

## Whisper mode

For speech well below normal conversation. Settings, **Whisper mode** (`audio.whisper_mode`,
off by default) makes the next recordings use up to +30 dB of gain instead of +24 dB, and
treats blocks down to -62 dBFS as speech instead of -55 dBFS, so soft speech is raised.
The limiter is unchanged, so loud speech still peaks under -1 dBFS. It can pick up more
background noise, which is why it is off by default.

## Microphone check

Settings, **Microphone check**: press Start and read the five sentences. The meter moves
with your voice (levels every 50 ms). Press Finish to get advice from two input levels
measured before gain: the voice (the loudest tenth of the time) and the background (the
quietest tenth). A gap of 35 dB or more suggests a headset or close-talk microphone, 20 dB
or more a built-in microphone in a quiet room works well, less suggests a headset; a voice
under -50 dB is "hard to hear". The advice changes no setting.

The check is an `audio.start` with `test: true`: the helper writes no file, and main writes
no history row. It uses the chosen microphone and the whisper setting.

Automatic choice: make a virtual device (for example an aggregate device in Audio MIDI Setup)
the system input and dictate: the log says Auto uses the real microphone. With an external
microphone and display, close the lid and dictate: the external microphone is used.
