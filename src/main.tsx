import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import './i18n'
import App from './App.tsx'
import './index.css'
import './redesign.css'
import './calculator.css'

/** Al cambiar de idioma la app se vuelve a montar: así se actualizan también los nombres del juego. */
function Root() {
  const { i18n } = useTranslation()
  return <App key={i18n.resolvedLanguage} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
