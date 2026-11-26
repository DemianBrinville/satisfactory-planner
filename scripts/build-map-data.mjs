// Arma src/data/map-nodes.json a partir de lo que extrae scripts/map-extract (yacimientos del juego instalado)
// y baja la imagen del mapa del juego desde la wiki oficial a public/map/map.jpg.
//
// Uso:
//   dotnet run -c Release --project scripts/map-extract -- "<carpeta de Satisfactory>" map-raw.json
//   node scripts/build-map-data.mjs map-raw.json [--image]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [rawPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!rawPath) {
  console.error('uso: node scripts/build-map-data.mjs <map-raw.json> [--image]')
  process.exit(1)
}
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'))
const m = (v) => Math.round(v) / 100 // cm del juego -> m con dos decimales
const PURITY = { RP_Inpure: 0, RP_Normal: 1, RP_Pure: 2 }
const pur = (p) => PURITY[p] ?? 1

// límites: el actor que captura el minimapa mira hacia abajo, centrado, con un ancho ortográfico
const cap = raw.find((o) => o.type === 'BP_MinimapCaptureActor_C')
const size = Number(cap.orthoWidth)
const bounds = { x0: m(cap.x - size / 2), y0: m(cap.y - size / 2), size: size / 100 }

const nodes = raw
  .filter((o) => o.type === 'BP_ResourceNode_C')
  .map((o) => [o.resource, pur(o.purity), m(o.x), m(o.y), m(o.z)])
  .sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2])
const geysers = raw.filter((o) => o.type === 'BP_ResourceNodeGeyser_C').map((o) => [pur(o.purity), m(o.x), m(o.y), m(o.z)])
const cores = raw.filter((o) => o.type === 'BP_FrackingCore_C')
const wells = cores.map((c) => {
  const sats = raw.filter((o) => o.type === 'BP_FrackingSatellite_C' && o.core === c.name)
  return { resource: sats[0]?.resource ?? c.resource, x: m(c.x), y: m(c.y), z: m(c.z), sats: sats.map((s) => [pur(s.purity), m(s.x), m(s.y), m(s.z)]) }
})

const out = { bounds, nodes, geysers, wells }
fs.writeFileSync(path.join(root, 'src/data/map-nodes.json'), JSON.stringify(out))
console.log(`yacimientos ${nodes.length}, géiseres ${geysers.length}, pozos ${wells.length} (${wells.reduce((a, w) => a + w.sats.length, 0)} satélites)`, bounds)

if (process.argv.includes('--image')) {
  // mapa del juego tal como lo muestra la wiki (5000 × 5000 px, mismos límites que el minimapa)
  const res = await fetch('https://satisfactory.wiki.gg/images/Map.jpg', { headers: { 'User-Agent': 'satisfactory-planner-map (community tool)' } })
  if (!res.ok) throw new Error('no se pudo bajar el mapa: ' + res.status)
  fs.mkdirSync(path.join(root, 'public/map'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public/map/map.jpg'), Buffer.from(await res.arrayBuffer()))
  console.log('public/map/map.jpg')
}
