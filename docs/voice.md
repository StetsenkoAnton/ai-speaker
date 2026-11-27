# Voice and pre-rendered speech

AI Speaker gives the talk in your cloned voice. The script is synthesized ahead of time, one
audio file per slide, and played from the cache during the talk: no network calls and no
generation delays on air. The first voice provider is Inworld TTS-2.

**Clone only your own voice.** Cloning someone else's voice without their consent is not allowed.

## Setup

```bash
npm run setup
```

Open http://localhost:5173/setup in Google Chrome:

1. **Inworld** shows whether `INWORLD_API_KEY` is set in `.env` (repository root).
2. **Devices**: output BlackHole 2ch (the meeting microphone), monitor your headphones. See
   [audio-routing.md](audio-routing.md).
3. **Voice**: list your cloned voices, say a test phrase, and choose the voice. The choice is
   written to `.env` as `INWORLD_VOICE_ID` after you confirm.
4. **Clone your voice**: record 10–30 seconds (at least 3) or pick a file, confirm that it is your
   own voice, and clone. Cloning needs an Inworld API key with **Write** access.

## Render

```bash
npm run render -- example            # asks before spending TTS characters
npm run render -- example --dry-run  # only show what would be synthesized
npm run render -- example --only idea --yes
```

`render` lists every script section and closing phrase, shows how many characters and roughly
how many minutes of speech it would synthesize, and asks for confirmation. Only what changed is
synthesized again.

- **Cache**: `talks/<talk>/.cache/audio/<hash>.wav` plus `manifest.json`. The hash covers the text
  (after the pronunciation dictionary), the voice, the model, the language and the sample rate.
  `.cache/` is not committed.
- **Long sections** are split at sentence ends into requests of up to 2,000 characters and joined
  into one file with a short pause.
- An interrupted render keeps everything it already synthesized.

## Pronunciation

`talks/<talk>/pronunciation.yaml` maps terms to what the voice should say. Terms match whole
words and are case-sensitive; longer terms win.

```yaml
Slidev: slide-dev
Vite: /viːt/      # IPA in slashes, one word only (Inworld TTS-2)
npm: N P M
```

## Closing phrases

After the last slide the talk says one closing phrase, picked at random, and waits for questions.
Five English phrases are built in. A talk can use its own in `talks/<talk>/phrases.yaml`:

```yaml
closing:
  - That's all from me. Thank you! Any questions?
  - Thanks for listening. What would you like to ask?
```

## During the talk

`npm run present -- <talk>` starts the server, the Stage and the Control window.

- **The Control window plays the talk.** The first Control window that connects is the player;
  keep it open. Choose the output and monitor in its Audio panel.
- **The server runs the talk.** Start plays the current slide; when its audio ends, the next slide
  comes up and plays. After the last slide a closing phrase plays and the talk waits for questions.
  Finish ends the session.
- **Pause** stops the speech; **Resume** replays the current slide from the start. Back and Next
  while presenting play the new slide at once.
- A slide without rendered audio stays up for its reading time, then the talk goes on.
- The speaker waveform on the Stage follows the real output level.
- Running `render` while `present` runs is picked up automatically.
