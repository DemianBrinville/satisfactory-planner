/// <reference lib="webworker" />
import { Parser } from '@etothepii/satisfactory-file-parser'
import type { SaveObj, SaveWorld, Vec3 } from './saveFile'

/**
 * Lee una partida (.sav) fuera del hilo de la interfaz y devuelve solo lo que usa el plano:
 * edificios con su posición, receta y conexiones, recorridos de cintas y tuberías, cables,
 * cimientos (construibles livianos) e hitos desbloqueados. Las medidas pasan de cm a m.
 */

type AnyObj = {
  typePath: string
  instanceName: string
  parentEntityName?: string
  properties: Record<string, any>
  specialProperties?: any
  transform?: { rotation: { x: number; y: number; z: number; w: number }; translation: Vec3 }
  components?: { pathName: string }[]
}

const cls = (path: string) => path.slice(path.lastIndexOf('.') + 1)
const shortName = (n: string) => n.slice(n.indexOf('PersistentLevel.') >= 0 ? n.indexOf('PersistentLevel.') + 16 : 0)
const ownerOf = (path: string) => shortName(path.slice(0, path.lastIndexOf('.')))
const yawOf = (q: { x: number; y: number; z: number; w: number }) => (Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)) * 180) / Math.PI
const m = (v: Vec3): Vec3 => ({ x: v.x / 100, y: v.y / 100, z: v.z / 100 })
const ref = (p: any): string | undefined => p?.value?.pathName || undefined

/** Muestrea la curva de la cinta (spline de Hermite de Unreal) en coordenadas del mundo. */
function sampleSpline(o: AnyObj): number[] {
  const t = o.transform!.translation
  const pts = (o.properties.mSplineData?.values ?? []).map((v: any) => ({
    p: v.properties.Location.value as Vec3,
    a: v.properties.ArriveTangent?.value as Vec3 | undefined,
    l: v.properties.LeaveTangent?.value as Vec3 | undefined,
  }))
  const out: number[] = []
  const push = (v: Vec3) => out.push((t.x + v.x) / 100, (t.y + v.y) / 100, (t.z + v.z) / 100)
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) {
      push(pts[0].p)
      continue
    }
    const p0 = pts[i - 1].p
    const p1 = pts[i].p
    const t0 = pts[i - 1].l ?? { x: 0, y: 0, z: 0 }
    const t1 = pts[i].a ?? { x: 0, y: 0, z: 0 }
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
    const straight = Math.hypot(t0.x, t0.y, t0.z) < 1 && Math.hypot(t1.x, t1.y, t1.z) < 1
    // un punto cada ~2 m en las curvas; los tramos rectos no necesitan más
    const n = straight ? 1 : Math.max(2, Math.min(24, Math.round(len / 200)))
    for (let k = 1; k <= n; k++) {
      const s = k / n
      const s2 = s * s
      const s3 = s2 * s
      const h00 = 2 * s3 - 3 * s2 + 1
      const h10 = s3 - 2 * s2 + s
      const h01 = -2 * s3 + 3 * s2
      const h11 = s3 - s2
      push({
        x: h00 * p0.x + h10 * t0.x + h01 * p1.x + h11 * t1.x,
        y: h00 * p0.y + h10 * t0.y + h01 * p1.y + h11 * t1.y,
        z: h00 * p0.z + h10 * t0.z + h01 * p1.z + h11 * t1.z,
      })
    }
  }
  return out.map((v) => Math.round(v * 100) / 100)
}

function extract(name: string, buffer: ArrayBuffer): SaveWorld {
  const save = Parser.ParseSave(name, buffer)
  const all: AnyObj[] = Object.values(save.levels as Record<string, { objects: AnyObj[] }>).flatMap((l) => l.objects)
  const byName = new Map(all.map((o) => [o.instanceName, o]))

  const objects: SaveObj[] = []
  const light: SaveWorld['light'] = []
  const lineOwners = new Map<string, string[]>()
  let schematics: string[] = []
  let phase = 0

  for (const o of all) {
    const c = cls(o.typePath)
    if (/SchematicManager/.test(o.typePath)) {
      schematics = (o.properties.mPurchasedSchematics?.values ?? []).map((v: any) => cls(v.pathName))
      continue
    }
    if (/GamePhaseManager/.test(o.typePath)) {
      const p = ref(o.properties.mCurrentGamePhase)?.match(/Phase_(\d+)/)
      if (p) phase = Number(p[1])
      continue
    }
    if (/LightweightBuildableSubsystem/.test(o.typePath)) {
      for (const b of o.specialProperties?.buildables ?? []) {
        const bc = cls(b.typeReference.pathName)
        for (const i of b.instances) {
          const p = m(i.transform.translation)
          light.push({ cls: bc, x: p.x, y: p.y, z: p.z, yaw: yawOf(i.transform.rotation) })
        }
      }
      continue
    }
    // cables: cada conexión eléctrica nombra las líneas que llegan a ella
    const wires = o.properties?.mWires?.values
    if (wires && !o.transform) {
      const owner = o.parentEntityName ? shortName(o.parentEntityName) : ownerOf(o.instanceName)
      for (const w of wires) {
        const key = shortName(w.pathName)
        const list = lineOwners.get(key) ?? []
        if (!list.includes(owner)) list.push(owner)
        lineOwners.set(key, list)
      }
      continue
    }
    if (!o.transform || !/^Build_/i.test(c) || c === 'Build_PowerLine_C') continue

    const p = m(o.transform.translation)
    const obj: SaveObj = { id: shortName(o.instanceName), cls: c, x: p.x, y: p.y, z: p.z, yaw: Math.round(yawOf(o.transform.rotation) * 100) / 100, conns: [] }
    const props = o.properties ?? {}
    const recipe = ref(props.mCurrentRecipe)
    if (recipe) obj.recipe = cls(recipe)
    if (props.mCurrentPotential?.value !== undefined) obj.clock = props.mCurrentPotential.value
    if (props.mCurrentProductionBoost?.value !== undefined) obj.boost = props.mCurrentProductionBoost.value
    const fuel = ref(props.mCurrentFuelClass)
    if (fuel) obj.fuel = cls(fuel)
    if (props.mSplineData) obj.spline = sampleSpline(o)
    const top = props.mTopTransform?.value?.properties?.Translation?.value
    if (top) obj.top = m(top)
    for (const comp of o.components ?? []) {
      const co = byName.get(comp.pathName)
      const target = ref(co?.properties?.mConnectedComponent)
      if (target) obj.conns.push([cls(comp.pathName), ownerOf(target), cls(target)])
    }
    objects.push(obj)
  }

  const powerLines: [string, string][] = []
  for (const owners of lineOwners.values()) if (owners.length === 2) powerLines.push([owners[0], owners[1]])

  return {
    session: (save.header as any).sessionName ?? name,
    buildVersion: (save.header as any).buildVersion ?? 0,
    objects,
    light,
    powerLines,
    schematics,
    phase,
  }
}

self.onmessage = (e: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try {
    const world = extract(e.data.name, e.data.buffer)
    ;(self as unknown as Worker).postMessage({ ok: true, world })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.message ?? err) })
  }
}
