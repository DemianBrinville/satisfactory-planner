// Genera src/data/names/<idioma>.json con los nombres oficiales del juego en cada idioma (ítems, edificios,
// recetas e hitos) a partir de CommunityResources/Docs/<archivo>.json. El español ya viene en game-data.json.
// El inglés además sirve para encontrar los iconos en la wiki.
//
// Uso:
//   node scripts/extract-names.mjs [carpeta Docs del juego] [idioma ...]
//   (sin idiomas: todos los de la interfaz)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = process.argv[2] ?? 'D:/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs'
/** idioma de la interfaz → archivo del juego */
const FILES = { en: 'en-US', de: 'de', fr: 'fr', pt: 'pt-BR', ru: 'ru', zh: 'zh-Hans', ja: 'ja', ko: 'ko', pl: 'pl' }
const langs = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(FILES)

const game = JSON.parse(fs.readFileSync(path.join(root, 'src/data/game-data.json'), 'utf8'))
fs.mkdirSync(path.join(root, 'src/data/names'), { recursive: true })

for (const lang of langs) {
  const buf = fs.readFileSync(path.join(docsDir, FILES[lang] + '.json'))
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8').replace(/^\uFEFF/, '')
  const byName = new Map(JSON.parse(text).flatMap((g) => g.Classes).map((c) => [c.ClassName, c]))
  const nameOf = (id) => byName.get(id)?.mDisplayName ?? null
  const out = { items: {}, buildings: {}, recipes: {}, schematics: {} }
  for (const id of Object.keys(game.items)) if (nameOf(id)) out.items[id] = nameOf(id)
  for (const b of game.buildings) {
    const c = byName.get(b.id)
    if (c?.mDisplayName) out.buildings[b.id] = { name: c.mDisplayName, description: (c.mDescription ?? '').replace(/\r?\n/g, '\n') }
  }
  for (const r of game.recipes) if (nameOf(r.id)) out.recipes[r.id] = nameOf(r.id)
  for (const s of game.schematics) if (nameOf(s.id)) out.schematics[s.id] = nameOf(s.id)
  fs.writeFileSync(path.join(root, `src/data/names/${lang}.json`), JSON.stringify(out))
  console.log(
    `names/${lang}.json: ${Object.keys(out.items).length} ítems, ${Object.keys(out.buildings).length} edificios, ${Object.keys(out.recipes).length} recetas, ${Object.keys(out.schematics).length} hitos`,
  )
}
