import { createApp } from 'vue';
import Control from './Control.vue';
import './styles.css';

// Stage 1 has a single page; /setup arrives at stage 2.
createApp(Control).mount('#root');
