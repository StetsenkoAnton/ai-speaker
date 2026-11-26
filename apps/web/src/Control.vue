<script setup lang="ts">
import { computed } from 'vue';
import { canTransition, type PresentationState } from '@ai-speaker/protocol';
import { useServer } from './useServer.ts';

const STATE_LABEL: Record<PresentationState, string> = {
  setup: 'Setup',
  ready: 'Ready',
  presenting: 'Presenting',
  qa: 'Q&A',
  paused: 'Paused',
  human_takeover: 'You have the floor',
  finished: 'Finished',
};

const { connected, snapshot, lastError, send } = useServer();

const slide = computed(() => snapshot.value?.talk.slides[snapshot.value.slideIndex]);
const navLocked = computed(() => snapshot.value?.state === 'finished');
const can = (to: PresentationState) => !!snapshot.value && canTransition(snapshot.value.state, to);

// Slidev's own views of the same deck. Only the audience view follows the server.
const views = computed(() => {
  const url = snapshot.value?.stageUrl;
  if (!url) return [];
  const origin = new URL(url).origin;
  return [
    { href: url, label: 'Stage', hint: 'audience view: share this window in the meeting' },
    { href: `${origin}/overview/`, label: 'Overview', hint: 'all slides on one page, to check the deck' },
    { href: `${origin}/presenter/`, label: 'Presenter', hint: "Slidev's speaker view with notes and the next slide; navigation there moves the Stage too" },
    { href: `${origin}/export/`, label: 'Export', hint: 'save the slides as PDF or PNG' },
  ];
});
</script>

<template>
  <main class="control">
    <template v-if="!snapshot">
      <h1>AI Speaker</h1>
      <p class="muted">{{ connected ? 'Loading…' : 'Connecting to the server… Is `ai-speaker present` running?' }}</p>
    </template>

    <template v-else>
      <header>
        <h1>{{ snapshot.talk.title }}</h1>
        <div class="status">
          <span :class="['state', `state-${snapshot.state}`]" data-testid="state">{{ STATE_LABEL[snapshot.state] }}</span>
          <span :class="connected ? 'ok' : 'bad'">{{ connected ? 'server connected' : 'server offline' }}</span>
          <span :class="snapshot.stages ? 'ok' : 'bad'" data-testid="stages">
            {{ snapshot.stages ? `Stage open (${snapshot.stages})` : 'Stage window not open' }}
          </span>
        </div>
      </header>

      <section class="current">
        <div class="muted">Slide {{ snapshot.slideIndex + 1 }} of {{ snapshot.talk.slides.length }}</div>
        <div class="slide-title" data-testid="slide-title">{{ slide?.title }}</div>
        <code class="muted">{{ slide?.id }}</code>
      </section>

      <section class="buttons">
        <button v-if="snapshot.state === 'ready'" @click="send({ type: 'start' })">Start</button>
        <button v-if="snapshot.state === 'presenting'" @click="send({ type: 'pause' })">Pause</button>
        <button v-if="snapshot.state === 'paused'" @click="send({ type: 'resume' })">Resume</button>
        <button :disabled="navLocked || snapshot.slideIndex === 0" @click="send({ type: 'prev_slide' })">◀ Back</button>
        <button
          :disabled="navLocked || snapshot.slideIndex >= snapshot.talk.slides.length - 1"
          @click="send({ type: 'next_slide' })"
        >
          Next ▶
        </button>
        <button class="secondary" :disabled="!can('finished')" @click="send({ type: 'finish' })">Finish</button>
      </section>
      <p v-if="lastError" class="error" role="alert">{{ lastError }}</p>

      <section v-if="views.length">
        <h2>Windows</h2>
        <ul class="views" data-testid="views">
          <li v-for="v in views" :key="v.label">
            <a :href="v.href" target="_blank" rel="noopener">{{ v.label }}</a>
            <span class="muted">{{ v.hint }}</span>
          </li>
        </ul>
      </section>

      <section>
        <h2>Slides</h2>
        <ol class="slides">
          <li v-for="(s, i) in snapshot.talk.slides" :key="s.id" :class="{ active: i === snapshot.slideIndex }">
            <button class="link" :disabled="navLocked" @click="send({ type: 'go_to_slide', slideId: s.id })">
              {{ s.title }}
            </button>
            <code class="muted">{{ s.id }}</code>
          </li>
        </ol>
      </section>
    </template>
  </main>
</template>
