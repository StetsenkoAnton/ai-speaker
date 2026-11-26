# Slidev as the Stage

The Stage window shows the talk's `slides.md` with [Slidev](https://sli.dev). AI Speaker does
not fork or wrap Slidev: it adds one global layer through a local addon. Verified with
Slidev 53.1.0.

## How it is wired

```text
ai-speaker present <talk>
  server   (apps/server)  state machine, WebSocket /ws on :8787
  stage    slidev talks/<talk>/slides.md --port 3030
           + addon @ai-speaker/stage (apps/stage/global-top.vue)
  control  vite apps/web on :5173 (/control)
```

- **Addon, not a theme.** `apps/stage` is a Slidev addon. The repository's `package.json` lists it
  in `slidev.addons`; Slidev reads the closest `package.json` above the entry file, so every talk
  under `talks/` gets the layer without any line in its `slides.md`.
- **Global layer.** `global-top.vue` is rendered once above all slides
  ([global layers](https://sli.dev/features/global-layers)). It is the only place that talks to
  the server.
- **Navigation.** The layer calls `useNav().go(n)` from `@slidev/client`
  ([global context](https://sli.dev/guide/global-context)) when the server sends `go_to_slide`, and
  sends `stage_slide` back when the deck moves for any other reason (keyboard, click). The echo of
  a server command is not reported back.
- **Only the audience view connects.** The presenter and print views also render global layers;
  the layer stays silent there (`isPresenter`, `isPrintMode`).
- **Server port.** The layer connects to `ws://<host>:8787/ws`; `?server=<port>` in the Stage URL
  overrides it.
- **Speaker layer.** The first `AvatarProvider` implementation is a small waveform in the
  bottom-right corner. Colour shows the activity (speaking, listening, thinking, idle), bar height
  follows the output level.
- **Assets.** Images are served from the talk's own `public/` folder, for example
  `talks/example/public/routing.svg` as `/routing.svg`.

## Slidev views

Slidev serves several views of the same deck. The Control window links them under "Windows":

| View | URL | Use |
|---|---|---|
| Stage | `/` | Audience view. Share this window in the meeting; only this view connects to the server |
| Overview | `/overview/` | All slides on one page, to check the deck |
| Presenter | `/presenter/` | Slidev's speaker view with notes and the next slide. Navigation there moves the Stage (Slidev syncs its views within one browser), and the Stage reports it to the server |
| Export | `/export/` | Save the slides as PDF or PNG |

`present` hides Slidev's and Vite's startup banners and prints only the Stage, Control and
server addresses.

## Slide ids

Every slide has an `id` in its frontmatter; the script uses the same ids. The format package
splits `slides.md` with Slidev's own parser (`@slidev/parser`), so slide indexes match what the
Stage shows. The first slide's frontmatter is also the deck headmatter (`theme`, `title`).

## Verified

| Check | Result |
|---|---|
| Server command moves the Slidev deck (`useNav().go`) | Works |
| Keyboard navigation on the Stage reaches the server and the Control window | Works |
| Global layer is visible above every slide | Works |
| Images from the talk's `public/` folder | Works |
| Presenter view navigation moves the Stage and reaches the server | Works (same browser) |

The end-to-end test `e2e/present.spec.ts` covers all of them (`npm run test:e2e`).

## Known limits

- Exporting slides with a navigation-dependent global layer needs `slidev export --per-slide`.
- Slidev asks for a screen wake lock; headless browsers deny it and log a harmless warning.
- Click animations (`v-click`) are not driven by the server yet: the server moves whole slides.
