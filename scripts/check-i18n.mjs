// Revisa las traducciones de la interfaz contra el inglés (src/i18n/locales/en/common.json):
// claves que faltan o sobran, variables ({{n}}), marcas (<b>, <kbd>…) y formas de plural de cada idioma.
//
// Uso: node scripts/check-i18n.mjs        (sale con error si algo no cuadra)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'src/i18n/locales')
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]))
const load = (lang) => Object.fromEntries(flat(JSON.parse(fs.readFileSync(path.join(dir, lang, 'common.json'), 'utf8'))))
const vars = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',')
const tags = (s) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort().join('')
const PLURAL = /_(zero|one|two|few|many|other)$/

const en = load('en')
const enBases = new Map()
for (const k of Object.keys(en)) if (PLURAL.test(k)) enBases.set(k.replace(PLURAL, ''), k)
// claves que solo usan español e inglés (el selector muestra cada idioma en su propio idioma)
const OPTIONAL = new Set(['language.es', 'language.en'])

let errors = 0
for (const lang of fs.readdirSync(dir)) {
  if (lang === 'en') continue
  const t = load(lang)
  // formas de plural que de verdad usa el idioma con cantidades comunes (en español, francés o portugués
  // "many" solo aparece con millones: no hace falta)
  const pr = new Intl.PluralRules(lang)
  const cats = [...new Set(Array.from({ length: 1001 }, (_, i) => pr.select(i)))]
  const problems = []
  for (const [k, v] of Object.entries(en)) {
    if (OPTIONAL.has(k)) continue
    if (PLURAL.test(k)) continue
    if (!(k in t)) problems.push(`falta ${k}`)
    else {
      if (vars(t[k]) !== vars(v)) problems.push(`variables distintas en ${k}: ${vars(t[k])} ≠ ${vars(v)}`)
      if (tags(t[k]) !== tags(v)) problems.push(`marcas distintas en ${k}`)
    }
  }
  for (const [base, sample] of enBases) {
    const want = vars(en[sample]).replace('count', '').split(',').filter(Boolean)
    for (const c of cats) {
      const k = `${base}_${c}`
      if (!(k in t)) problems.push(`falta el plural ${k}`)
      else if (want.some((w) => !vars(t[k]).split(',').includes(w))) problems.push(`faltan variables en ${k}`)
    }
  }
  for (const k of Object.keys(t)) if (!(k in en) && !(PLURAL.test(k) && enBases.has(k.replace(PLURAL, '')))) problems.push(`sobra ${k}`)
  console.log(`${lang}: ${problems.length ? problems.length + ' problema(s)' : 'bien'} (plural: ${cats.join(', ')})`)
  for (const p of problems.slice(0, 30)) console.log('   ' + p)
  errors += problems.length
}
process.exit(errors ? 1 : 0)
