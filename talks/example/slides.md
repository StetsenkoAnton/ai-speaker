---
theme: default
title: A talk delivered by an agent in my voice
id: intro
layout: cover
---

# A talk delivered by an agent in my voice

AI Speaker demo

---
id: idea
---

# The idea

- An agent prepares the talk: outline, slides, script
- It speaks with my cloned voice in the meeting
- It answers questions on the topic
- One button gives the floor back to me

---
id: routing
---

# How the sound gets into the call

<img src="/routing.svg" alt="Agent voice goes to BlackHole 2ch, which is the meeting microphone" class="mx-auto h-72" />

---
id: format
---

# A talk is a folder of text files

```text
talks/example/
  brief.md      # topic, audience, length, language
  slides.md     # Slidev slides, each with an id
  script.md     # what the speaker says, one section per slide
  knowledge/    # extra material for answering questions
```

---
id: code
---

# Moving the slides from the server

```ts
const { go } = useNav()

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.type === 'go_to_slide') go(message.index + 1)
}
```

---
id: outro
layout: center
---

# Questions?

The agent will try to answer. If it cannot, I take over.
