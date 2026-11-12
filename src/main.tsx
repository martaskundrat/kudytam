import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { startAlightWatcher } from './lib/alight'
import './index.css'

registerSW({ immediate: true })
// rozběhnutá upozornění na výstup (po znovuotevření aplikace)
startAlightWatcher()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
