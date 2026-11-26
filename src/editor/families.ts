import { buildingsById } from '../data/gameData'

/**
 * Familias de variantes: la tecla E pasa a la siguiente (como el "Cambio rápido" del juego)
 * y los atajos numéricos eligen la familia. El nombre visible de cada una está en las
 * traducciones (families.<clave>).
 */
export const FAMILIES: Record<string, { ids: string[] }> = {
  belt: {
    ids: [1, 2, 3, 4, 5, 6].map((n) => `Build_ConveyorBeltMk${n}_C`),
  },
  pipe: { ids: ['Build_Pipeline_C', 'Build_PipelineMK2_C'] },
  pipeClean: { ids: ['Build_Pipeline_NoIndicator_C', 'Build_PipelineMK2_NoIndicator_C'] },
  lift: { ids: [1, 2, 3, 4, 5, 6].map((n) => `Build_ConveyorLiftMk${n}_C`) },
  splitter: {
    ids: ['Build_ConveyorAttachmentSplitter_C', 'Build_ConveyorAttachmentSplitterSmart_C', 'Build_ConveyorAttachmentSplitterProgrammable_C'],
  },
  merger: { ids: ['Build_ConveyorAttachmentMerger_C', 'Build_ConveyorAttachmentMergerPriority_C'] },
  foundation: { ids: ['Build_Foundation_8x1_01_C', 'Build_Foundation_8x2_01_C', 'Build_Foundation_8x4_01_C'] },
  beltPole: { ids: ['Build_ConveyorPole_C', 'Build_ConveyorPoleStackable_C'] },
  pipeSupport: { ids: ['Build_PipelineSupport_C', 'Build_PipeSupportStackable_C'] },
  pump: { ids: ['Build_PipelinePump_C', 'Build_PipelinePumpMk2_C'] },
  pipeJunction: { ids: ['Build_PipelineJunction_Cross_C', 'Build_PipelineJunction_T_C'] },
  miner: { ids: ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C'] },
  powerPole: { ids: ['Build_PowerPoleMk1_C', 'Build_PowerPoleMk2_C', 'Build_PowerPoleMk3_C'] },
}
for (const f of Object.values(FAMILIES)) f.ids = f.ids.filter((id) => buildingsById.has(id))

/** Atajos numéricos, al estilo de la barra rápida del juego. */
export const HOTKEYS: { key: string; family: string }[] = [
  { key: '1', family: 'belt' },
  { key: '2', family: 'pipe' },
  { key: '3', family: 'splitter' },
  { key: '4', family: 'merger' },
  { key: '5', family: 'beltPole' },
  { key: '6', family: 'pipeSupport' },
  { key: '7', family: 'foundation' },
  { key: '8', family: 'lift' },
  { key: '9', family: 'pump' },
  { key: '0', family: 'pipeJunction' },
]

export function familyOf(buildingId: string): string | null {
  for (const [k, f] of Object.entries(FAMILIES)) if (f.ids.includes(buildingId)) return k
  return null
}

/** Siguiente variante de la familia, saltando las no disponibles; vuelve al principio al final. */
export function nextVariant(buildingId: string, isAvailable: (id: string) => boolean, dir: 1 | -1 = 1): string {
  const fam = familyOf(buildingId)
  if (!fam) return buildingId
  const ids = FAMILIES[fam].ids
  const i = ids.indexOf(buildingId)
  for (let step = 1; step <= ids.length; step++) {
    const cand = ids[(i + dir * step + ids.length * 2) % ids.length]
    if (isAvailable(cand)) return cand
  }
  return buildingId
}
