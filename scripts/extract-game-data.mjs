// Genera src/data/game-data.json a partir de:
//  1) El archivo oficial del juego CommunityResources/Docs/es-ES.json (nombres en español,
//     costos, recetas, huellas de colisión, velocidades, progreso).
//  2) Los infobox de la wiki (satisfactory.wiki.gg): cantidad de puertos de cinta/tubería.
//
// Uso:
//   node scripts/extract-game-data.mjs "<ruta a es-ES.json>" [--refresh-wiki]
//
// El resultado se commitea para que el deploy no dependa del juego instalado.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
  'D:/Program Files (x86)/Steam/steamapps/common/Satisfactory/CommunityResources/Docs/es-ES.json'
const wikiCache = path.join(root, 'scripts', 'wiki-infobox.json')
const outPath = path.join(root, 'src', 'data', 'game-data.json')

// ---------- lectura del Docs del juego ----------
function readDocs(file) {
  const buf = fs.readFileSync(file)
  const text =
    buf[0] === 0xff && buf[1] === 0xfe
      ? buf.toString('utf16le').slice(1)
      : buf.toString('utf8').replace(/^\uFEFF/, '')
  return JSON.parse(text).flatMap((g) => g.Classes)
}
const classes = readDocs(docsPath)
const byName = new Map(classes.map((c) => [c.ClassName, c]))

const num = (v) => (v === undefined || v === '' ? 0 : Number(v))
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d
const shortClass = (ref) => ref.match(/\.([A-Za-z0-9_]+_C)'?"?$/)?.[1] ?? ref
const classRefs = (s) => [...(s ?? '').matchAll(/[./]([A-Za-z0-9_-]+_C)['"]/g)].map((m) => m[1])
const amounts = (s) =>
  [...(s ?? '').matchAll(/ItemClass="[^"]*\.([A-Za-z0-9_]+_C)'",Amount=(\d+)/g)].map((m) => ({
    item: m[1],
    amount: Number(m[2]),
  }))

// ---------- wiki: puertos y tamaños declarados ----------
async function loadWiki() {
  if (fs.existsSync(wikiCache) && !process.argv.includes('--refresh-wiki')) {
    return JSON.parse(fs.readFileSync(wikiCache, 'utf8'))
  }
  const UA = { headers: { 'User-Agent': 'satisfactory-planner-data-extractor' } }
  const api = 'https://satisfactory.wiki.gg/api.php'
  const titles = []
  let cont = ''
  do {
    const r = await (
      await fetch(
        `${api}?action=query&list=embeddedin&eititle=Template:Infobox_building&einamespace=0&eilimit=500&format=json${cont}`,
        UA,
      )
    ).json()
    titles.push(...r.query.embeddedin.map((x) => x.title).filter((t) => !t.includes('/')))
    cont = r.continue ? `&eicontinue=${r.continue.eicontinue}` : ''
  } while (cont)
  const out = {}
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50)
    const r = await (
      await fetch(
        `${api}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(batch.join('|'))}`,
        UA,
      )
    ).json()
    for (const p of Object.values(r.query.pages)) {
      const text = p.revisions?.[0]?.slots?.main?.['*'] ?? ''
      for (const m of text.matchAll(/\{\{Infobox building([\s\S]*?)\n\}\}/g)) {
        const o = {}
        for (const line of m[1].split(/\n|\|/)) {
          const mm = line.match(/^\s*(\w+)\s*=\s*(.*?)\s*$/)
          if (mm) o[mm[1]] = mm[2]
        }
        if (o.className) out[o.className] = o
      }
    }
  }
  fs.writeFileSync(wikiCache, JSON.stringify(out, null, 1))
  return out
}
const wiki = await loadWiki()
const portCount = (v) => {
  // "1", "1-4" (uniones: rango) → tomamos el máximo
  const n = String(v ?? '0').split('-').map(Number)
  return Math.max(...n.filter((x) => !Number.isNaN(x)), 0)
}

// ---------- categorías: subcarpeta del juego → menú del juego en español ----------
const CATEGORY = {
  SC_Progression: ['especial', 'Progresión'],
  SC_AWESOME: ['especial', 'Programa de bonificación FLIPANTE'],
  SC_BlueprintDesigners: ['especial', 'Diseñadores de planos FICSIT'],
  SC_Workstations: ['especial', 'Estaciones de trabajo'],
  SC_Event: ['especial', 'Eventos'],
  SC_Manufacturers: ['produccion', 'Productores'],
  SC_Smelters: ['produccion', 'Hornos'],
  SC_Miners: ['produccion', 'Taladros'],
  SC_OilProduction: ['produccion', 'Extractores de fluidos'],
  SC_Generators: ['electricidad', 'Generadores'],
  SC_PowerPoles: ['electricidad', 'Distribución de energía'],
  SC_WallPoles: ['electricidad', 'Distribución de energía'],
  SC_ConveyorBelts: ['logistica', 'Cintas transportadoras'],
  SC_ConveyLift: ['logistica', 'Cintas elevadoras'],
  SC_ConverPole: ['logistica', 'Soportes para cintas'],
  SC_Pipes: ['logistica', 'Tuberías'],
  SC_PipeSupport: ['logistica', 'Soportes para tuberías'],
  SC_ConveyorAttachments: ['logistica', 'Ordenación'],
  SC_Storage: ['organizacion', 'Almacenamiento'],
  SC_Towers: ['organizacion', 'Torres'],
  SC_Lights: ['organizacion', 'Iluminación'],
  SC_Signs: ['organizacion', 'Carteles'],
  SC_Utility: ['organizacion', 'Utilidades'],
  SC_Vehicles: ['transporte', 'Transporte vehicular'],
  SC_VehiclePaths: ['transporte', 'Rutas de vehículo'],
  SC_HyperTubes: ['transporte', 'Hipertubos'],
  SC_JumpPads: ['transporte', 'Plataformas de salto'],
  SC_Trains: ['transporte', 'Trenes'],
  SC_Elevators: ['transporte', 'Ascensores'],
  SC_Portal: ['transporte', 'Portales'],
  SC_Monitoring: ['transporte', 'Monitoreo'],
  SC_Floors: ['cimientos', 'Cimientos'],
  SC_Ramps: ['cimientos', 'Rampas'],
  SC_Inverted: ['cimientos', 'Rampas invertidas'],
  SC_QuatPipes: ['cimientos', 'Cuartos de tubo'],
  SC_Walls: ['paredes', 'Paredes básicas'],
  SC_Windows: ['paredes', 'Ventanas'],
  SC_WindowFrames: ['paredes', 'Marcos de ventana'],
  SC_ConveyorConnections: ['paredes', 'Paredes con conexiones'],
  SC_AngularWalls: ['paredes', 'Paredes angulares'],
  SC_DiagonalWalls: ['paredes', 'Paredes diagonales'],
  SC_UpperDiagonalWalls: ['paredes', 'Paredes diagonales superiores'],
  SC_Doors: ['paredes', 'Puertas'],
  SC_Beams: ['arquitectura', 'Vigas'],
  SC_Pillars: ['arquitectura', 'Pilares'],
  SC_Walkways: ['arquitectura', 'Pasarelas'],
  SC_Catwalks: ['arquitectura', 'Pasarelas de rejilla'],
  SC_Frames: ['arquitectura', 'Armazones'],
  SC_Roofs: ['arquitectura', 'Techos'],
  SC_Attach: ['arquitectura', 'Accesorios'],
}

// ---------- huella: unión en planta de las cajas de colisión no "soft" ----------
function footprint(c) {
  const s = c.mClearanceData ?? ''
  const boxes = []
  const re =
    /\((Type=(\w+),)?ClearanceBox=\(Min=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\),Max=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\)[^)]*\)(,RelativeTransform=\((Rotation=\([^)]*\),)?Translation=\(X=([-\d.]+),Y=([-\d.]+),Z=([-\d.]+)\))?/g
  for (const m of s.matchAll(re)) {
    if (m[2] === 'CT_Soft') continue
    const tx = num(m[11]), ty = num(m[12])
    boxes.push({ x0: +m[3] + tx, y0: +m[4] + ty, x1: +m[6] + tx, y1: +m[7] + ty, z1: +m[8] })
  }
  if (!boxes.length && s) {
    // solo hay cajas soft (cimientos, paredes): las usamos
    for (const m of s.matchAll(re)) {
      const tx = num(m[11]), ty = num(m[12])
      boxes.push({ x0: +m[3] + tx, y0: +m[4] + ty, x1: +m[6] + tx, y1: +m[7] + ty, z1: +m[8] })
    }
  }
  if (!boxes.length) return null
  const u = boxes.reduce((a, b) => ({
    x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), z1: Math.max(a.z1, b.z1),
  }))
  // metros. En el juego el eje largo es Y; en el plano: ancho = X, largo = Y.
  return { minX: u.x0 / 100, maxX: u.x1 / 100, minY: u.y0 / 100, maxY: u.y1 / 100, height: u.z1 / 100 }
}

// ---------- tipo de edificio (define cómo se dibuja y se calcula) ----------
function kindOf(id, c) {
  if (/ConveyorBelt/.test(id)) return 'belt'
  if (/ConveyorLift/.test(id)) return 'lift'
  if (/^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.test(id)) return 'pipe'
  if (/ConveyorAttachment(Splitter|Merger)/.test(id)) return 'splitter'
  if (/PipelineJunction/.test(id)) return 'pipeJunction'
  if (/PipelinePump/.test(id)) return 'pump'
  if (/Valve/.test(id)) return 'valve'
  if (/^Build_Miner/.test(id)) return 'miner'
  if (/WaterPump|OilPump|FrackingExtractor/.test(id)) return 'extractor'
  if (/Generator/.test(id)) return 'generator'
  if (/Foundation|Ramp|Floor/.test(id)) return 'foundation'
  if (/Wall/.test(id) && !/Pole|Hole|Mount|Support|Floodlight/.test(id)) return 'wall'
  if (c.mManufacturingSpeed !== undefined) return 'machine'
  return 'structure'
}

// ---------- recetas de construcción (pistola) ----------
const allRecipes = classes.filter((c) => c.ClassName?.startsWith('Recipe_') && c.mProduct)
const buildRecipeByDesc = new Map()
for (const r of allRecipes) {
  if (!/BuildGun/.test(r.mProducedIn ?? '')) continue
  const prod = amounts(r.mProduct)[0]
  if (prod) buildRecipeByDesc.set(prod.item, r)
}

// ---------- schematics (progreso) ----------
const MAM_TREES = {
  Quartz: 'Cuarzo', Caterium: 'Caterio', PowerSlugs: 'Babosas de energía', AlienOrganisms: 'Organismos alienígenas',
  Sulfur: 'Azufre', Mycelia: 'Micelios', Nutrients: 'Nutrientes', AlienTech: 'Tecnología alienígena',
} // XMas (evento) se excluye
const isFluid = (id) => ['RF_LIQUID', 'RF_GAS'].includes(byName.get(id)?.mForm)
const toUnits = (list) => list.map((x) => (isFluid(x.item) ? { ...x, amount: x.amount / 1000 } : x))
const recipeUnlockedBy = new Map()
const schematics = classes
  .filter((c) => c.ClassName?.startsWith('Schematic_') || ['EST_Milestone', 'EST_MAM', 'EST_Alternate', 'EST_ResourceSink', 'EST_Tutorial'].includes(c.mType))
  .filter((c) => ['EST_Milestone', 'EST_MAM', 'EST_Alternate', 'EST_ResourceSink', 'EST_Tutorial'].includes(c.mType))
  .map((s) => {
    const recipes = (s.mUnlocks ?? []).flatMap((u) => classRefs(u.mRecipes))
    for (const r of recipes) {
      if (!recipeUnlockedBy.has(r)) recipeUnlockedBy.set(r, [])
      recipeUnlockedBy.get(r).push(s.ClassName)
    }
    const mamTree = s.mType === 'EST_MAM' ? MAM_TREES[(s.FullName ?? '').match(/Research\/([A-Za-z]+)_RS\//)?.[1]] ?? null : null
    if (s.mType === 'EST_MAM' && !mamTree) return null
    return {
      id: s.ClassName,
      name: s.mDisplayName,
      type: s.mType.replace('EST_', '').toLowerCase(),
      tier: num(s.mTechTier),
      cost: amounts(s.mCost),
      recipes,
      dependencies: (s.mSchematicDependencies ?? []).flatMap((d) => classRefs(d.mSchematics)),
      mamTree,
    }
  })
  .filter((s) => s && s.name)

// Tier → fase del Ascensor espacial (1.0): T0-2 fase 1, T3-4 fase 2, T5-6 fase 3, T7-8 fase 4, T9 fase 5
const phaseOfTier = (t) => (t <= 2 ? 1 : t <= 4 ? 2 : t <= 6 ? 3 : t <= 8 ? 4 : 5)

// ---------- edificios ----------
const buildings = []
for (const c of classes) {
  const id = c.ClassName
  if (!id?.startsWith('Build_') || !c.mDisplayName) continue
  const descId = id.replace(/^Build_/, 'Desc_')
  const desc = byName.get(descId)
  const sub = desc?.mSubCategories?.match(/BuildCategories\/[^/]+\/(SC_[A-Za-z]+)/)?.[1]
  if (!sub || !CATEGORY[sub]) continue
  const recipe = buildRecipeByDesc.get(descId)
  if (!recipe) continue
  const fp = footprint(c)
  const w = wiki[descId]
  const kind = kindOf(id, c)
  const size =
    fp ?? (c.mWidth ? { minX: -num(c.mWidth) / 200, maxX: num(c.mWidth) / 200, minY: -num(c.mDepth) / 200, maxY: num(c.mDepth) / 200, height: num(c.mHeight) / 100 } : null)
  const b = {
    id,
    name: c.mDisplayName,
    description: (c.mDescription ?? '').replace(/\r?\n/g, '\n'),
    category: CATEGORY[sub][0],
    subcategory: CATEGORY[sub][1],
    priority: num(desc.mMenuPriority),
    kind,
    footprint: size && {
      minX: round(size.minX), maxX: round(size.maxX), minY: round(size.minY), maxY: round(size.maxY), height: round(size.height),
    },
    wikiSize: w ? { width: w.size_width, length: w.size_length, height: w.size_height } : null,
    ports: {
      beltIn: portCount(w?.beltInputs),
      beltOut: portCount(w?.beltOutputs),
      pipeIn: portCount(w?.pipeInputs),
      pipeOut: portCount(w?.pipeOutputs),
    },
    powerMW: num(c.mPowerConsumption),
    powerGenMW: num(c.mPowerProduction),
    cost: amounts(recipe.mIngredients),
    buildRecipe: recipe.ClassName,
    unlockedBy: recipeUnlockedBy.get(recipe.ClassName) ?? [],
  }
  // ranuras de amplificación (somersloops) y capacidad de almacenamiento
  if (num(c.mProductionShardSlotSize) > 0 && c.mCanChangeProductionBoost === 'True') b.somersloopSlots = num(c.mProductionShardSlotSize)
  if (num(c.mInventorySizeX) > 0) b.inventorySlots = num(c.mInventorySizeX) * num(c.mInventorySizeY)
  if (kind === 'belt' || kind === 'lift') b.itemsPerMinute = num(c.mSpeed) / 2
  if (kind === 'pipe') b.flowPerMinute = num(c.mFlowLimit) * 60
  if (kind === 'miner' || kind === 'extractor') {
    // unidades/min en un nodo normal al 100 %. Fluidos: el juego usa 1000 = 1 m³.
    const perCycle = num(c.mItemsPerCycle)
    const cycle = num(c.mExtractCycleTime) || 1
    b.extractPerMinute = round(((kind === 'extractor' ? perCycle / 1000 : perCycle) / cycle) * 60)
  }
  if (c.mFuel) b.fuels = c.mFuel.map((f) => ({ fuel: f.mFuelClass, supplement: f.mSupplementalResourceClass || null }))
  buildings.push(b)
}

// ---------- recetas de máquinas ----------
const buildingIds = new Set(buildings.map((b) => b.id))
const recipes = allRecipes
  .map((r) => {
    const producedIn = classRefs(r.mProducedIn).filter((x) => buildingIds.has(x))
    if (!producedIn.length || (r.mRelevantEvents ?? '').includes('EV_')) return null
    return {
      id: r.ClassName,
      name: r.mDisplayName,
      alternate: /Alternate/.test(r.FullName ?? '') || r.ClassName.startsWith('Recipe_Alternate'),
      duration: num(r.mManufactoringDuration),
      ingredients: toUnits(amounts(r.mIngredients)),
      products: toUnits(amounts(r.mProduct)),
      producedIn,
      unlockedBy: recipeUnlockedBy.get(r.ClassName) ?? [],
      variablePower: num(r.mVariablePowerConsumptionConstant) || null,
    }
  })
  .filter(Boolean)

// ---------- ítems usados ----------
const usedItems = new Set()
for (const b of buildings) b.cost.forEach((x) => usedItems.add(x.item))
for (const r of recipes) [...r.ingredients, ...r.products].forEach((x) => usedItems.add(x.item))
for (const s of schematics) s.cost.forEach((x) => usedItems.add(x.item))
for (const b of buildings) (b.fuels ?? []).forEach((f) => { usedItems.add(f.fuel); if (f.supplement) usedItems.add(f.supplement) })
const items = {}
for (const id of usedItems) {
  const c = byName.get(id)
  if (!c) continue
  items[id] = {
    name: c.mDisplayName,
    form: (c.mForm ?? 'RF_SOLID').replace('RF_', '').toLowerCase(),
    stackSize: c.mStackSize?.replace('SS_', '') ?? null,
    sinkPoints: num(c.mResourceSinkPoints) || null,
    energyMJ: num(c.mEnergyValue) || null,
  }
}

// ---------- fases ----------
const phases = [1, 2, 3, 4, 5].map((p) => ({ phase: p, tiers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((t) => phaseOfTier(t) === p && (t > 0 || p === 1)) }))

const data = {
  source: { docs: path.basename(docsPath), generatedAt: new Date().toISOString().slice(0, 10) },
  phases,
  buildings: buildings.sort((a, b) => a.category.localeCompare(b.category) || a.priority - b.priority),
  recipes,
  items,
  schematics,
}
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(data))
console.log(
  `edificios ${buildings.length}, recetas ${recipes.length}, ítems ${Object.keys(items).length}, schematics ${schematics.length} → ${path.relative(root, outPath)} (${Math.round(fs.statSync(outPath).size / 1024)} KB)`,
)
