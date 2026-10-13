import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { showMountFailure } from './core/app/mountFailure'
import './styles/tokens.css'
import './styles/base.css'
import './styles/forms.css'
import './styles/map.css'

try {
  const app = createApp(App)
  app.config.errorHandler = (cause, _instance, info) => {
    console.error(`筑瞳组件运行失败（${info}）：`, cause)
    if (document.querySelector('#app')?.children.length === 0) showMountFailure(cause)
  }
  app.use(createPinia()).use(router).mount('#app')
} catch (cause) {
  showMountFailure(cause)
}
