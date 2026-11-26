import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { setGameLanguage } from '../data/gameData'
import en from './locales/en/common.json'
import es from './locales/es/common.json'

/**
 * Traducciones de la interfaz (i18next). Los textos viven en locales/<idioma>/common.json y se
 * piden con claves (`t('topbar.calculator')`). Los nombres del juego (ítems, edificios, recetas)
 * salen de los archivos oficiales del juego en cada idioma, no de estas traducciones.
 *
 * Para sumar un idioma: agregar locales/<código>/common.json, sumarlo a SUPPORTED y a `resources`,
 * y generar sus nombres del juego con scripts/extract-names.mjs.
 */
export const SUPPORTED = ['es', 'en'] as const
export type Language = (typeof SUPPORTED)[number]

export const resources = {
  es: { common: es },
  en: { common: en },
} as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS: 'common',
    ns: ['common'],
    supportedLngs: [...SUPPORTED],
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    // la mayoría juega en inglés: es el idioma de reserva si el navegador pide uno que no está
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'satisfactory-planner:lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  })

const apply = (lng: string) => {
  const lang = (SUPPORTED as readonly string[]).includes(lng.slice(0, 2)) ? (lng.slice(0, 2) as Language) : 'en'
  setGameLanguage(lang)
  document.documentElement.lang = lang
}
apply(i18n.resolvedLanguage ?? i18n.language ?? 'en')
i18n.on('languageChanged', apply)

export default i18n
