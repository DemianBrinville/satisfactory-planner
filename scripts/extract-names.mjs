// Genera src/data/game-names-en.json con los nombres oficiales en inglés (ítems, edificios, recetas
// e hitos) a partir de CommunityResources/Docs/en-US.json del juego. Sirve para mostrar la app en
// inglés y para encontrar los iconos en la wiki.
//
// Uso:
//   node scripts/extract-names.mjs ["<ruta a en-US.json>"]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsPath =
  process.argv[2] ?? 'D:/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json'

const buf = fs.readFileSync(docsPath)
const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('utf8').replace(/^\uFEFF/, '')
const byName = new Map(JSON.parse(text).flatMap((g) => g.Classes).map((c) => [c.ClassName, c]))

const game = JSON.parse(fs.readFileSync(path.join(root, 'src/data/game-data.json'), 'utf8'))
const nameOf = (id) => byName.get(id)?.mDisplayName ?? null

const out = { items: {}, buildings: {}, recipes: {}, schematics: {} }
for (const id of Object.keys(game.items)) if (nameOf(id)) out.items[id] = nameOf(id)
for (const b of game.buildings) {
  const c = byName.get(b.id)
  if (c?.mDisplayName) out.buildings[b.id] = { name: c.mDisplayName, description: (c.mDescription ?? '').replace(/\r?\n/g, '\n') }
}
for (const r of game.recipes) if (nameOf(r.id)) out.recipes[r.id] = nameOf(r.id)
for (const s of game.schematics) if (nameOf(s.id)) out.schematics[s.id] = nameOf(s.id)

fs.writeFileSync(path.join(root, 'src/data/game-names-en.json'), JSON.stringify(out))
console.log(
  `game-names-en.json: ${Object.keys(out.items).length} ítems, ${Object.keys(out.buildings).length} edificios, ${Object.keys(out.recipes).length} recetas, ${Object.keys(out.schematics).length} hitos`,
)
