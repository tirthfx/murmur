# Sounds and output mute

## Sounds

Murmur's own tones, synthesised by `node scripts/make-sounds.mjs` into `apps/desktop/src/renderer/bar/sounds/` (16-bit mono WAV, sine notes with soft envelopes; nothing sampled). The Bar page plays them at half volume.

| Sound   | When                                    | Default |
| ------- | --------------------------------------- | ------- |
| start   | before recording starts                 | on      |
| lock    | hands-free turns on                     | on      |
| success | text recognised                         | on      |
| error   | transcription failed, mic did not start | on      |
| cancel  | Escape discarded a recording            | off     |

Each can be turned off in Settings. The start sound plays first and recording waits 170 ms for it to finish, so it is never in the recorded audio.

## Mute other audio while dictating

Off by default. When on, at the start of a recording Murmur reads the output's mute switch:

- already muted, or no mute switch: nothing changes;
- otherwise it writes `output-muted-by-murmur.json` in the app's data folder, then mutes.

When the recording ends for any reason (stop, Escape, a failed start) Murmur unmutes and deletes the file. If Murmur was killed while muted, the file is still there, and the next launch (or the next helper start) unmutes and deletes it.

Only the mute switch is touched, never the volume, so a volume change during a dictation stays.

## Manual test

1. Settings → Sounds and audio: turn on "Mute other audio while dictating". Play music.
2. Hold Right Option: the start tone plays, then the music goes silent. Release: the music comes back.
3. Mute the Mac yourself, dictate: it stays muted afterwards.
4. With the music playing and the setting on, hold Right Option and quit Murmur from Activity Monitor. Start `npm run dev` again: the music is audible again.
5. Loopback check: record a dictation with the start sound on and `MURMUR_LOG_TRANSCRIPTS=1`; the file in `audio/tmp` (16 kHz raw PCM) starts with silence, not the tone.
