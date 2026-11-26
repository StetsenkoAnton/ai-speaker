# Audio routing on macOS

How AI Speaker talks into an online meeting and hears the participants. No meeting bots or
platform APIs: the app only uses virtual audio devices and window sharing, so the same setup
works in Microsoft Teams, Zoom and Google Meet. Verified with Microsoft Teams on macOS.

## Devices

```text
agent voice  -> BlackHole 2ch                                    -> meeting: microphone
participants -> meeting: speaker = Multi-Output (headphones + BlackHole 16ch) -> agent
agent voice  -> optional monitor (headphones directly, never the Multi-Output device)
slides       -> Stage window                                     -> meeting: share window
```

BlackHole devices are virtual cables: whatever is played into a BlackHole output appears on the
input of the same device. They make no sound on their own.

## Setup

1. `brew install blackhole-2ch blackhole-16ch`, then restart the meeting app so it sees them.
2. Audio MIDI Setup -> `+` -> Create Multi-Output Device. Enable your headphones and
   BlackHole 16ch. Primary device: headphones. Enable drift correction for BlackHole 16ch.
3. In the meeting app (Teams: Settings -> Devices, custom setup):
   - microphone: **BlackHole 2ch** (not BlackHole 16ch, not "Microsoft Teams Audio Device");
   - speaker: the Multi-Output device.
4. macOS: System Settings -> Privacy & Security -> Microphone: allow the meeting app and Chrome.
5. Open the AI Speaker pages in **Google Chrome** (or Edge).

## Things to know

- **Your own microphone is not in the call.** The meeting microphone is BlackHole 2ch, so the
  participants hear only the agent. Taking over the talk sends your microphone into the same
  BlackHole 2ch, so meeting settings never change on air.
- **Safari does not work.** It has no `AudioContext.setSinkId`, so audio cannot be sent to
  BlackHole 2ch and plays through the default output instead.
- **Choose devices before joining the meeting.** Teams may ignore a device change made during a
  call; rejoin if it does.
- Volume keys do not work while the Multi-Output device is the system output. It does not need to
  be the system output: select it only as the meeting speaker.
- When capturing BlackHole 16ch, turn off `echoCancellation`, `noiseSuppression` and
  `autoGainControl` in `getUserMedia`.

## Debugging "the participants hear nothing"

Follow the chain and find where the sound stops:

1. **The page plays.** Pick your headphones as the monitor and play a test sound.
2. **BlackHole 2ch receives it.** QuickTime Player -> New Audio Recording -> microphone
   BlackHole 2ch; record while the test sound plays.
3. **The meeting app receives it.** The microphone level bar in the meeting app's device settings
   moves while the test sound plays. If not, restart the meeting app and check the microphone is
   BlackHole 2ch.
4. **The meeting app sends it.** The microphone is not muted in the call; try lower noise
   suppression; rejoin the call.

## Status

| Check | Result |
|---|---|
| Page -> BlackHole 2ch -> Teams microphone, participant on a phone hears it | Works (Chrome) |
| Inworld TTS-2 cloned voice played into the call | Works |
| BlackHole 16ch capture level and echo | Not verified yet |
| Teams noise suppression and synthesized voice | Not verified yet |
| Stability over 20 minutes with window sharing | Not verified yet |
