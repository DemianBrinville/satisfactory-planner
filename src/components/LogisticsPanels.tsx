import i18n from '../i18n'
import { Trans, useTranslation } from 'react-i18next'
import { locale } from '../i18n/format'
import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, type Building } from '../data/gameData'
import { FILTER_ANY, FILTER_NONE, FILTER_OVERFLOW, FILTER_UNDEFINED, type EdgeFlow } from '../editor/flow'
import { VEHICLES, roundTrip, routeDistance, routeThroughput, type Route, type VehicleKind } from '../editor/transport'
import { useEditor, type PlacedEntity } from '../editor/store'

/** Salidas de un divisor por número de puerto (ver portsOf): 1 centro, 2 izquierda, 3 derecha. */
const SPLITTER_OUTS: [number, 'left' | 'center' | 'right'][] = [
  [2, 'left'],
  [1, 'center'],
  [3, 'right'],
]
/** Entradas de un fusionador por número de puerto: 1 centro, 2 izquierda, 3 derecha. */
const MERGER_INS: [number, 'left' | 'center' | 'right'][] = [
  [2, 'left'],
  [1, 'center'],
  [3, 'right'],
]

const SPECIAL = [FILTER_ANY, FILTER_NONE, FILTER_UNDEFINED, FILTER_OVERFLOW]
const FILTER_KEYS: Record<string, 'filters.any' | 'filters.none' | 'filters.undefined' | 'filters.overflow'> = {
  [FILTER_ANY]: 'filters.any',
  [FILTER_NONE]: 'filters.none',
  [FILTER_UNDEFINED]: 'filters.undefined',
  [FILTER_OVERFLOW]: 'filters.overflow',
}
const solidItems = () =>
  Object.entries(game.items)
  .filter(([, i]) => i.form === 'solid')
  .map(([id, i]) => ({ id, name: i.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const label = (f: string) => (FILTER_KEYS[f] ? i18n.t(FILTER_KEYS[f]) : itemName(f))

export function SplitterPanel({ e, b }: { e: PlacedEntity; b: Building }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const programmable = /Programmable/.test(b.id)
  const filters = e.filters ?? {}
  const setFilters = (port: number, list: string[]) => update(e.uid, { filters: { ...filters, [port]: list } })

  return (
    <section className="machine">
      <h2>{b.name}</h2>
      <p className="muted">
        <Trans i18nKey="splitter.help" components={{ b: <b /> }} />
      </p>
      {SPLITTER_OUTS.map(([port, name]) => {
        const list = filters[port] ?? [FILTER_ANY]
        return (
          <div key={port} className="filter-row">
            <h3>{t(`sides.${name}`)}</h3>
            {programmable ? (
              <MultiFilter list={list} onChange={(l) => setFilters(port, l)} />
            ) : (
              <FilterSelect value={list[0] ?? FILTER_NONE} onChange={(v) => setFilters(port, [v])} />
            )}
          </div>
        )
      })}
    </section>
  )
}

function FilterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {SPECIAL.map((f) => (
        <option key={f} value={f}>
          {label(f)}
        </option>
      ))}
      <optgroup label={i18n.t('common.items')}>
        {solidItems().map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function MultiFilter({ list, onChange }: { list: string[]; onChange: (l: string[]) => void }) {
  const [adding, setAdding] = useState('')
  const options = useMemo(() => [...SPECIAL, ...solidItems().map((i) => i.id)].filter((f) => !list.includes(f)), [list])
  return (
    <div className="chips">
      {list.map((f) => (
        <span key={f} className="chip">
          {label(f)}
          <button onClick={() => onChange(list.filter((x) => x !== f))} title={i18n.t('common.remove')}>
            ×
          </button>
        </span>
      ))}
      <select
        value={adding}
        onChange={(e) => {
          if (e.target.value) onChange([...list.filter((x) => x !== FILTER_NONE), e.target.value])
          setAdding('')
        }}
      >
        <option value="">{i18n.t('filters.add')}</option>
        {options.map((f) => (
          <option key={f} value={f}>
            {label(f)}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PriorityMergerPanel({ e, b }: { e: PlacedEntity; b: Building }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const prios = e.priorities ?? {}
  return (
    <section className="machine">
      <h2>{b.name}</h2>
      <p className="muted">{t('merger.help')}</p>
      {MERGER_INS.map(([port, name]) => (
        <div key={port} className="flowline">
          <span>{t(`sides.${name}`)}</span>
          <select value={prios[port] ?? 1} onChange={(ev) => update(e.uid, { priorities: { ...prios, [port]: Number(ev.target.value) } })}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {t('merger.priority', { n })}
              </option>
            ))}
          </select>
        </div>
      ))}
    </section>
  )
}

const STACK: Record<string, number> = { ONE: 1, SMALL: 50, MEDIUM: 100, BIG: 200, HUGE: 500, FLUID: 50 }
/** Capacidad de los depósitos de fluidos (m³). */
const FLUID_CAPACITY: Record<string, number> = { Build_PipeStorageTank_C: 400, Build_IndustrialTank_C: 2400 }

/** Contenedores y depósitos: capacidad y cuánto tardan en llenarse o vaciarse con los flujos actuales. */
export function StoragePanel({
  e,
  b,
  inflow,
  outflow,
}: {
  e: PlacedEntity
  b: Building
  inflow: Map<string, number>
  outflow: Map<string, number>
}) {
  void e
  const { t } = useTranslation()
  const fluidCap = FLUID_CAPACITY[b.id]
  const items = [...new Set([...inflow.keys(), ...outflow.keys()])]
  return (
    <section className="machine">
      <h2>{b.name}</h2>
      <p className="muted">
        {fluidCap ? t('storage.capacityFluid', { n: fluidCap }) : t('storage.capacitySlots', { n: b.inventorySlots })}
      </p>
      {items.length === 0 && <p className="muted">{t('storage.connect')}</p>}
      {items.map((i) => {
        const inn = inflow.get(i) ?? 0
        const out = outflow.get(i) ?? 0
        const net = inn - out
        const cap = fluidCap ?? (b.inventorySlots ?? 0) * (STACK[game.items[i]?.stackSize ?? 'MEDIUM'] ?? 100)
        const minutes = net !== 0 ? cap / Math.abs(net) : Infinity
        return (
          <div key={i} className="tt-item">
            <b>{itemName(i)}</b>
            <div className="muted">
              {t('storage.rates', { inn: inn.toFixed(1), out: out.toFixed(1), cap: cap.toLocaleString(locale()) })}
            </div>
            <div className={net > 0.01 ? 'warn' : net < -0.01 ? 'bad' : 'ok'}>
              {net > 0.01 && t('storage.fills', { time: fmtTime(minutes) })}
              {net < -0.01 && t('storage.empties', { time: fmtTime(minutes) })}
              {Math.abs(net) <= 0.01 && t('storage.steady')}
            </div>
          </div>
        )
      })}
    </section>
  )
}

const fmtTime = (min: number) => (min >= 120 ? `${(min / 60).toFixed(1)} h` : min >= 1 ? `${min.toFixed(1)} min` : `${Math.round(min * 60)} s`)

/** Ruta entre dos estaciones: vehículo, cantidad, distancia y capacidad resultante. */
export function RoutePanel({ r, entities, floorHeight, flow }: { r: Route; entities: PlacedEntity[]; floorHeight?: number; flow?: EdgeFlow }) {
  const { t } = useTranslation()
  const { updateRoute } = useEditor()
  const spec = VEHICLES[r.kind]
  const a = entities.find((e) => e.uid === r.from)
  const b = entities.find((e) => e.uid === r.to)
  const options = (Object.keys(VEHICLES) as VehicleKind[]).filter((k) => a && VEHICLES[k].stations.test(a.buildingId))
  const dist = routeDistance(r, entities, floorHeight)
  const trip = roundTrip(r, entities, floorHeight)
  const items = flow ? [...flow.offer.keys()] : []
  return (
    <section className="machine">
      <h2>{t(`route.title.${r.kind}`)}</h2>
      <p className="muted">
        {a && buildingsById.get(a.buildingId)?.name} → {b && buildingsById.get(b.buildingId)?.name}
      </p>
      {options.length > 1 && (
        <div className="segmented">
          {options.map((k) => (
            <button key={k} className={r.kind === k ? 'active' : ''} onClick={() => updateRoute(r.uid, { kind: k })}>
              {t(`vehicles.${k}`)}
            </button>
          ))}
        </div>
      )}
      <div className="flowline">
        <span>{r.kind === 'train' ? t('route.wagons') : t('route.vehicles')}</span>
        <input
          className="small-input"
          type="number"
          min={1}
          value={r.count ?? 1}
          onChange={(ev) => updateRoute(r.uid, { count: Math.max(1, Number(ev.target.value)) })}
        />
      </div>
      <div className="flowline">
        <span title={t('route.distanceHint')}>{t('route.distance')}</span>
        <input
          className="small-input wide"
          type="number"
          min={0}
          placeholder={String(Math.round(dist))}
          value={r.distance ?? ''}
          onChange={(ev) => updateRoute(r.uid, { distance: ev.target.value ? Number(ev.target.value) : undefined })}
        />
      </div>
      <div className="flowline">
        <span>{t('route.speed')}</span>
        <input
          className="small-input"
          type="number"
          min={5}
          placeholder={String(spec.speed)}
          value={r.speed ?? ''}
          onChange={(ev) => updateRoute(r.uid, { speed: ev.target.value ? Number(ev.target.value) : undefined })}
        />
      </div>
      <p className="muted">
        {t('route.roundTrip', { t: trip.toFixed(0), dist: (2 * dist).toFixed(0), dock: spec.dock.toFixed(0) })}{' '}
        {t(r.kind === 'train' ? 'route.carriesWagon' : 'route.carriesVehicle', { slots: spec.slots })}
        {spec.fluid ? t('route.orFluid', { m3: spec.fluid }) : ''}.
      </p>
      <h3>{t('route.capacity')}</h3>
      {items.length === 0 && (
        <p className="muted">
          {t('route.genericCapacity', { n: routeThroughput(r, null, entities, floorHeight).toFixed(1) })}
        </p>
      )}
      {items.map((i) => {
        const cap = routeThroughput(r, i, entities, floorHeight)
        const f = flow?.flow.get(i) ?? 0
        const offered = flow?.offer.get(i) ?? 0
        return (
          <div key={i} className="tt-item">
            <b>{itemName(i)}</b>
            <div className={offered > cap + 0.05 ? 'bad' : 'muted'}>
              {t('route.carries', { f: f.toFixed(1), cap: cap.toFixed(1) })}
              {offered > cap + 0.05 && t('route.short')}
            </div>
          </div>
        )
      })}
    </section>
  )
}
