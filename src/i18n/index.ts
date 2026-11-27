import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { loadGameNames, setGameLanguage } from '../data/gameData'
import en from './locales/en/common.json'
import es from './locales/es/common.json'

/**
 * Traducciones de la interfaz (i18next). Los textos viven en locales/<idioma>/common.json y se
 * piden con claves (`t('topbar.calculator')`). Los nombres del juego (ítems, edificios, recetas)
 * salen de los archivos oficiales del juego en cada idioma (data/names), no de estas traducciones.
 *
 * Español e inglés vienen incluidos; el resto se descarga cuando se elige (textos y nombres del juego).
 * Para sumar un idioma: agregar locales/<código>/common.json, sumarlo a SUPPORTED y a LANGUAGE_NAMES,
 * y generar sus nombres del juego con scripts/extract-names.mjs.
 */
export const SUPPORTED = ['es', 'en', 'de', 'fr', 'pt', 'ru', 'pl', 'ja', 'ko', 'zh'] as const
export type Language = (typeof SUPPORTED)[number]

/** Nombre de cada idioma en su propio idioma (para el selector). */
export const LANGUAGE_NAMES: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  pt: 'Português (Brasil)',
  ru: 'Русский',
  pl: 'Polski',
  ja: '日本語',
  ko: '한국어',
  zh: '简体中文',
}

export const resources = {
  es: { common: es },
  en: { common: en },
} as const

const UI_FILES = import.meta.glob<{ default: Record<string, unknown> }>(['./locales/*/common.json', '!./locales/{es,en}/common.json'])
const toSupported = (lng: string | undefined): Language => {
  const short = (lng ?? 'en').slice(0, 2) as Language
  return (SUPPORTED as readonly string[]).includes(short) ? short : 'en'
}

/** Descarga los textos y los nombres del juego de un idioma (si hace falta). */
async function ensureLanguage(lang: Language) {
  if (!i18n.hasResourceBundle(lang, 'common')) {
    const file = UI_FILES[`./locales/${lang}/common.json`]
    if (file) i18n.addResourceBundle(lang, 'common', (await file()).default, true, true)
  }
  await loadGameNames(lang)
}

/** Cambia el idioma de la interfaz y del juego (descargándolo primero si no está). */
export async function changeLanguage(lng: string) {
  const lang = toSupported(lng)
  await ensureLanguage(lang)
  await i18n.changeLanguage(lang)
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
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
  const lang = toSupported(lng)
  setGameLanguage(lang)
  document.documentElement.lang = lang
}
i18n.on('languageChanged', apply)

/** Listo para dibujar: el idioma detectado ya tiene sus textos y nombres del juego. */
export const i18nReady = (async () => {
  const lang = toSupported(i18n.resolvedLanguage ?? i18n.language)
  await ensureLanguage(lang)
  if (i18n.language !== lang || !i18n.hasResourceBundle(lang, 'common')) await i18n.changeLanguage(lang)
  apply(lang)
})()

export default i18n
