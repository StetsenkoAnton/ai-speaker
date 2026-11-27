import { createApp } from 'vue';
import Control from './Control.vue';
import Setup from './Setup.vue';
import './styles.css';

// Two pages, no router needed: /setup and everything else is the Control window.
const page = location.pathname.startsWith('/setup') ? Setup : Control;
document.title = page === Setup ? 'AI Speaker Setup' : 'AI Speaker Control';
createApp(page).mount('#root');
