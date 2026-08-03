import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { setupPwa } from './lib/usePwaUpdate.js'

createApp(App).mount('#app')

// Register the PWA service worker + iOS-safe foreground update re-check.
setupPwa()
