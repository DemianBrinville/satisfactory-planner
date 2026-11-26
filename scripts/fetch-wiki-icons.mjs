// Baja los iconos oficiales de ítems y edificios desde la wiki (satisfactory.wiki.gg) en 64 px a
// public/icons/<id>.png y escribe src/data/icon-manifest.json con los ids que tienen imagen.
// Los iconos son de Coffee Stain Studios; la app usa sus propios dibujos para lo que no se encuentre.
//
// Uso (después de extract-names.mjs):
//   node scripts/fetch-wiki-icons.mjs [--force]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'icons')
const manifestPath = path.join(root, 'src', 'data', 'icon-manifest.json')
const names = JSON.parse(fs.readFileSync(path.join(root, 'src/data/game-names-en.json'), 'utf8'))
const force = process.argv.includes('--force')
const UA = { headers: { 'User-Agent': 'satisfactory-planner-icons (community tool)' } }
const API = 'https://satisfactory.wiki.gg/api.php'

/** Archivos de la wiki con nombre distinto al del juego. */
const OVERRIDES = {}

fs.mkdirSync(outDir, { recursive: true })

const wanted = [
  ...Object.entries(names.items).map(([id, name]) => ({ id, name })),
  ...Object.entries(names.buildings).map(([id, b]) => ({ id, name: b.name })),
]
const candidates = (w) => {
  const base = OVERRIDES[w.id] ?? w.name
  return [...new Set([base, base.replace(/"/g, ''), base.replace(/\s*\(.*\)$/, '')])].map((n) => `File:${n.replace(/[#<>[\]|{}]/g, '')}.png`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function lookup(titles) {
  const url = `${API}?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=url&iiurlwidth=64&format=json`
  const r = await (await fetch(url, UA)).json()
  const norm = new Map((r.query.normalized ?? []).map((n) => [n.to, n.from]))
  const found = new Map()
  for (const p of Object.values(r.query.pages)) {
    const info = p.imageinfo?.[0]
    if (!info) continue
    const thumb = info.thumburl ?? info.url
    found.set(p.title, thumb)
    if (norm.has(p.title)) found.set(norm.get(p.title), thumb)
  }
  return found
}

const manifest = new Set()
const missing = []
const todo = wanted.filter((w) => {
  if (!force && fs.existsSync(path.join(outDir, `${w.id}.png`))) {
    manifest.add(w.id)
    return false
  }
  return true
})

// consulta por lotes de 50 títulos
const allTitles = [...new Set(todo.flatMap(candidates))]
const urls = new Map()
for (let i = 0; i < allTitles.length; i += 50) {
  const found = await lookup(allTitles.slice(i, i + 50))
  for (const [t, u] of found) urls.set(t, u)
  await sleep(300)
}

for (const w of todo) {
  const t = candidates(w).find((c) => urls.has(c) || urls.has(c.replace(/_/g, ' ')))
  const url = t && (urls.get(t) ?? urls.get(t.replace(/_/g, ' ')))
  if (!url) {
    missing.push(`${w.id} (${w.name})`)
    continue
  }
  const res = await fetch(url, UA)
  if (!res.ok) {
    missing.push(`${w.id} (${w.name}) HTTP ${res.status}`)
    continue
  }
  fs.writeFileSync(path.join(outDir, `${w.id}.png`), Buffer.from(await res.arrayBuffer()))
  manifest.add(w.id)
  await sleep(60)
}

fs.writeFileSync(manifestPath, JSON.stringify([...manifest].sort()))
console.log(`Iconos: ${manifest.size} disponibles, ${missing.length} sin imagen en la wiki`)
if (missing.length) fs.writeFileSync(path.join(root, 'scripts', 'icons-missing.txt'), missing.join('\n'))
