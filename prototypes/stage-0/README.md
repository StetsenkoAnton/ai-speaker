# Stage 0 — audio prototype

Throwaway prototype. It answers one question: can an agent speak with a cloned voice into a
Microsoft Teams call and hear the participants, without echo, on macOS?

One page without design and a small Node server. The server holds the Inworld API key; the
browser only gets a short-lived Realtime session token and synthesized audio.

## Audio routing

```text
agent voice  -> BlackHole 2ch                              -> Teams: microphone
participants -> Teams: speaker = Multi-Output (headphones + BlackHole 16ch) -> this page
agent voice  -> optional monitor output (headphones directly, never the Multi-Output device)
```

## Prerequisites

- macOS, Node.js 22.18+ (runs TypeScript natively), Google Chrome.
- `brew install blackhole-2ch blackhole-16ch`.
- Audio MIDI Setup -> Multi-Output Device: your headphones + BlackHole 16ch.
- `.env` in the repository root with `INWORLD_API_KEY` and `INWORLD_VOICE_ID` (see `.env.example`).
  Optional: `INWORLD_TTS_MODEL` (default `inworld-tts-2`), `SERVER_PORT` (default `8787`).

## Run

```bash
npm install
npm run tts-check -- "Hello, this is my cloned voice."   # terminal check of the key and voice
npm run dev                                               # server on :8787, page on :5173
```

Open http://localhost:5173 in **Google Chrome** (or Edge). Safari does not work: it has no
`AudioContext.setSinkId`, so the agent voice cannot be sent to BlackHole 2ch. The page shows a red
warning and logs `setSinkId failed` in that case.

## What the page does

| Section | Task | What to check |
|---|---|---|
| Devices | 0.7, 0.8 | Grant mic access; pick BlackHole 2ch as agent output, BlackHole 16ch as meeting input |
| Output test | 0.7 | The phone participant hears three beeps and a sweep |
| Input level | 0.8 | The meter moves when the participant speaks and stays at zero when only the agent plays (see the two peak values) |
| File TTS | 0.9, 0.15 | The cloned voice through Teams, undistorted |
| Live session | 0.10–0.13 | Voice question -> spoken answer; Listen modes A/B/C; STOP; typed question |
| Latency | 0.14 | End of question -> first sound, per question and median |
| Stability | 0.16 | Replays the last TTS clip for 20 minutes and logs drift and device changes |

Listen modes:

- **A** — `turn_detection: null`; Listen clears the input buffer, closing it sends
  `input_audio_buffer.commit` + `response.create`. Not documented by Inworld; watch the log for
  `session.updated` and errors.
- **B** — `semantic_vad`; meeting audio is sent only while Listen is on.
- **C** — `semantic_vad`; meeting audio is always sent. Only for the echo test.

STOP sends `response.cancel` for the active response, drops queued audio in the player and logs
how long the output took to go silent.

The log panel has a Copy button: paste it into the stage notes after each check.
