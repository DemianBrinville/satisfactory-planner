import i18n from './index'

/** Idioma actual para formatear números (coma o punto decimal según el idioma). */
export const locale = () => i18n.resolvedLanguage ?? 'en'

/** Número con hasta `d` decimales en el formato del idioma actual. */
export const fmtNum = (n: number, d = 2) => n.toLocaleString(locale(), { maximumFractionDigits: d })

/** Porcentaje (1 = 100 %) en el formato del idioma actual. */
export const fmtPct = (v: number, d = 2) => `${fmtNum(v * 100, d)} %`
