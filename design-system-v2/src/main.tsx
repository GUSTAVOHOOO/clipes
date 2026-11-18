import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './galeria/galeria.css'
import { App } from './galeria/App'

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
