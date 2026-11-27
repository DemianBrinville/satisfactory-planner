// Baja los iconos oficiales de ítems y edificios desde la wiki (satisfactory.wiki.gg) en 128 px a
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
const names = JSON.parse(fs.readFileSync(path.join(root, 'src/data/names/en.json'), 'utf8'))
const force = process.argv.includes('--force')
const UA = { headers: { 'User-Agent': 'satisfactory-planner-icons (community tool)' } }
const API = 'https://satisfactory.wiki.gg/api.php'

/** Archivos de la wiki con nombre distinto al del juego. */
const OVERRIDES = {}

fs.mkdirSync(outDir, { recursive: true })

const wanted = [
  ...Object.entries(names.items).map(([id, name]) => ({ id, name })),
  ...Object.entries(names.buildings).map(([id, b]) => ({ id, name: b.name })),
].map((w) => ({ ...w, name: w.name.replace(/[  ]/g, ' ') })) // el juego usa espacios finos entre número y unidad
/** Nombre del material como aparece en los archivos de la wiki. */
const WIKI_MATERIAL = (id) =>
  /PolishedConcrete|ConcretePolished|Polished/.test(id)
    ? 'Coated'
    : /Asphalt/.test(id)
      ? 'Asphalt'
      : /Steel/.test(id)
        ? 'Steel'
        : /GripMetal|Grip|_Metal_/.test(id)
          ? 'Grip Metal'
          : /Concrete/.test(id)
            ? 'Concrete'
            : 'FICSIT'

/** Reglas para las piezas cuyo archivo en la wiki usa otro formato de nombre. */
function ruleTitle(w) {
  const mat = WIKI_MATERIAL(w.id)
  const size = w.name.match(/\((\d+) m\)/)?.[1]
  const rules = [
    [/^Inverted Ramp Wall/, () => `Inv. Ramp Wall ${size}m (${mat === 'FICSIT' ? 'Steel' : mat})`],
    [/^Inverted Ramp \(/, () => `Inv. Ramp ${size}m (${mat})`],
    [/^Inverted Up Corner/, () => `Inv. Up Corner ${size}m (${mat})`],
    [/^Inverted Down Corner/, () => `Inv. Down Corner ${size}m (${mat})`],
    // la wiki solo tiene la escalera de 4 m: se usa para los tres tamaños
    [/^Foundation Stairs/, () => `Foundation Stair 4m (${mat})`],
    [/^Conveyor Wall x (\d)/, (m) => `Conveyor Wall x${m[1]} (${mat === 'Coated' ? 'Concrete' : mat})`],
    [/^Perpendicular Wall Conveyor/, () => `Wall Conveyor Perpendicular (${mat === 'Steel' ? 'Sheet Metal' : 'Plating'})`],
    [/^Walkway T-Junction/, () => 'Walkway T-Crossing'],
    [/^Walkway Intersection/, () => 'Walkway Crossing'],
    // no existe la versión revestida: se usa la de hormigón
    [/^Inverted Outer Corner Quarter Pipe/, () => `Inverted Outer Corner Quarter Pipe (${mat === 'Coated' ? 'Concrete' : mat})`],
  ]
  for (const [re, f] of rules) {
    const m = w.name.match(re)
    if (m) return f(m)
  }
  return null
}

const candidates = (w) => {
  const rule = ruleTitle(w)
  if (rule) return [`File:${rule}.png`]
  const base = OVERRIDES[w.id] ?? w.name
  return [...new Set([base, base.replace(/"/g, ''), base.replace(/\s*\(.*\)$/, '')])].map((n) => `File:${n.replace(/[#<>[\]|{}]/g, '')}.png`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Consulta a la API de la wiki respetando su límite: si responde "ratelimited", espera y reintenta. */
async function api(url) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const r = await (await fetch(url, UA)).json()
    if (r.error?.code !== 'ratelimited') return r
    await sleep(4000 * attempt)
  }
  throw new Error('La wiki sigue limitando las consultas; prueba de nuevo más tarde.')
}
const searchCachePath = path.join(root, 'scripts', 'wiki-icon-search.json')
const searchCache = fs.existsSync(searchCachePath) ? JSON.parse(fs.readFileSync(searchCachePath, 'utf8')) : {}

async function lookup(titles) {
  const url = `${API}?action=query&titles=${encodeURIComponent(titles.join('|'))}&prop=imageinfo&iiprop=url&iiurlwidth=128&format=json`
  const r = await api(url)
  if (!r.query) {
    console.warn('lookup sin resultado:', JSON.stringify(r.error ?? r).slice(0, 200))
    return new Map()
  }
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

// ---------- segunda pasada: variantes de arquitectura ----------
// En la wiki los cimientos, rampas, techos y paredes llevan el material en el nombre del archivo y con
// formatos distintos ("Foundation 1m (FICSIT)", "Tar Roof 4m", "Inv. Up Corner 2m (Concrete)"). Se busca
// cada pieza en el buscador de la wiki y se elige el archivo que coincide en forma, tamaño y material.
const MATERIALS = [
  [/PolishedConcrete|ConcretePolished|Polished/, ['coated']],
  [/Asphalt/, ['asphalt']],
  [/GripMetal|Grip|Foundation_Metal|Ramp_Metal|InvertedRamp_Metal|RampDouble_Metal|DCorner_Metal|UCorner_Metal|UpCorner_Metal|DownCorner_Metal/, ['grip', 'metal']],
  [/Roof_Tar/, ['tar']],
  [/Roof_Window/, ['glass']],
  [/Roof_Metal|Roof_A_/, ['metal', 'steel']],
  [/Steel/, ['steel']],
  [/Concrete/, ['concrete']],
]
const materialOf = (id) => MATERIALS.find(([re]) => re.test(id))?.[1] ?? ['ficsit']
const norm = (t) =>
  t
    .toLowerCase()
    .replace(/^file:/, '')
    .replace(/\.png$/, '')
    .replace(/_/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/(\d)\s*m\b/g, '$1m')
    .replace(/inv\./g, 'inverted')
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

async function search(q) {
  if (searchCache[q]) return searchCache[q]
  const url = `${API}?action=query&list=search&srnamespace=6&srlimit=40&srsearch=${encodeURIComponent(q)}&format=json`
  const r = await api(url)
  const titles = (r.query?.search ?? []).map((x) => x.title)
  searchCache[q] = titles
  fs.writeFileSync(searchCachePath, JSON.stringify(searchCache))
  await sleep(1500)
  return titles
}

/** Mejor archivo para una pieza: tiene que coincidir el tamaño y el material; gana el que más palabras comparte. */
function pick(w, titles) {
  const nameTok = norm(w.name)
  const size = nameTok.find((t) => /^\d+m$/.test(t))
  const core = nameTok.filter((t) => !/^\d+m$/.test(t))
  const mats = materialOf(w.id)
  let best = null
  for (const t of titles) {
    const tok = norm(t)
    if (size && !tok.includes(size)) continue
    if (!size && tok.some((x) => /^\d+m$/.test(x))) continue
    const anyMat = ['ficsit', 'concrete', 'asphalt', 'coated', 'grip', 'metal', 'steel', 'tar', 'glass', 'plating', 'sheet'].some((m) => tok.includes(m))
    if (anyMat && !mats.some((m) => tok.includes(m))) continue
    const hit = core.filter((c) => tok.includes(c)).length
    const extra = tok.filter((x) => !core.includes(x) && x !== size && !mats.includes(x) && !['ficsit', 'flat'].includes(x)).length
    const score = hit / core.length - 0.15 * extra
    if (hit / core.length >= 0.6 && (!best || score > best.score)) best = { t, score }
  }
  return best?.t ?? null
}

const second = todo.filter((w) => !candidates(w).some((c) => urls.has(c) || urls.has(c.replace(/_/g, ' '))))
const chosen = new Map()
for (const w of second) {
  const mats = materialOf(w.id)
  const words = w.name.replace(/[()]/g, ' ').replace(/(\d)\s*m\b/g, '$1m').replace(/\s+/g, ' ').trim()
  let t = pick(w, await search(`${words} ${mats[0]}`))
  if (!t) t = pick(w, await search(words))
  if (t) chosen.set(w.id, t)
}
const chosenTitles = [...new Set(chosen.values())]
for (let i = 0; i < chosenTitles.length; i += 50) {
  const found = await lookup(chosenTitles.slice(i, i + 50))
  for (const [t, u] of found) urls.set(t, u)
  await sleep(1500)
}

for (const w of todo) {
  const t = candidates(w).find((c) => urls.has(c) || urls.has(c.replace(/_/g, ' '))) ?? chosen.get(w.id)
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
  await sleep(150)
}

fs.writeFileSync(manifestPath, JSON.stringify([...manifest].sort()))
console.log(`Iconos: ${manifest.size} disponibles, ${missing.length} sin imagen en la wiki`)
const missingPath = path.join(root, 'scripts', 'icons-missing.txt')
if (missing.length) fs.writeFileSync(missingPath, missing.join('\n'))
else fs.rmSync(missingPath, { force: true })
