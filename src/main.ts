import { createApp } from 'vue'
import App from './App.vue'
import './styles/base.css'

import { initPwa } from './app/pwa'

createApp(App).mount('#app')
initPwa()
