import i18n from '../i18n'
import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { CATEGORIES, game, isPathKind, itemName, type Building } from '../data/gameData'
import { useAvailability } from '../editor/progress'
import { useEditor } from '../editor/store'
import { RAIL, type VehicleKind } from '../editor/transport'
import { BuildingIcon } from './GameIcons'
import { BlocksPanel } from './Blocks'

/** Las "Rutas de vehículo" del menú del juego abren la herramienta de rutas. */
const ROUTE_KINDS: Record<string, VehicleKind> = {
  Build_VehiclePath_Truck_C: 'truck',
  Build_VehiclePath_Universal_C: 'truck',
  Build_VehiclePath_Tractor_C: 'tractor',
  Build_VehiclePath_Explorer_C: 'explorer',
}

export default function Palette() {
  const { t } = useTranslation()
  const { category, setCategory, startPlacing, startConveyor, startWire, startRail, startRoute, placingId, conveyorId, tool } = useEditor()
  const [query, setQuery] = useState('')
  // pestaña de bloques guardados (como la de planos del menú de construcción del juego)
  const [blocks, setBlocks] = useState(false)
  const avail = useAvailability()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = game.buildings.filter((b) => (q ? b.name.toLowerCase().includes(q) : b.category === category) && avail.building(b))
    const map = new Map<string, Building[]>()
    for (const b of list) {
      const key = b.subcategoryId ?? b.subcategory
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return [...map]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, query, avail.enabled, avail.building])

  return (
    <aside className="palette">
      <nav className="cats">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={c.id === category && !query && !blocks ? 'active' : ''}
            onClick={() => {
              setQuery('')
              setBlocks(false)
              setCategory(c.id)
            }}
          >
            {t(`categories.${c.id}`)}
          </button>
        ))}
        <button className={'cats-blocks' + (blocks ? ' active' : '')} onClick={() => setBlocks(true)} title={t('blocks.tabTitle')}>
          {t('blocks.tab')}
        </button>
      </nav>
      {blocks ? (
        <div className="items">
          <BlocksPanel />
        </div>
      ) : (
      <div className="items">
        <input className="search" placeholder={t('palette.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        {groups.map(([sub, list], gi) => (
          <section key={sub}>
            <h3>
              {gi + 1}. {t(`subcategories.${sub}` as 'subcategories.SC_Miners', { defaultValue: sub })}
            </h3>
            <div className="grid">
              {list.map((b) => {
                const path = isPathKind(b.kind)
                const f = b.footprint
                const dims = path
                  ? b.kind === 'hyper'
                    ? '≤ 100 m'
                    : b.itemsPerMinute
                    ? `${b.itemsPerMinute}/min`
                    : `${b.flowPerMinute} m³/min`
                  : f
                    ? `${round(f.maxX - f.minX)} × ${round(f.maxY - f.minY)} m`
                    : ''
                const isWire = b.id === 'Build_PowerLine_C'
                const active = placingId === b.id || conveyorId === b.id || (isWire && tool === 'wire')
                return (
                  <button
                    key={b.id}
                    className={'item' + (active ? ' active' : '')}
                    title={tooltip(b) + (path ? '\n\n' + t('palette.pathHint') : '')}
                    onClick={() => {
                      if (isWire) return startWire()
                      if (b.id === RAIL) return startRail()
                      const route = ROUTE_KINDS[b.id]
                      if (route) return startRoute(route)
                      return path ? startConveyor(b.id) : startPlacing(b.id)
                    }}
                  >
                    <BuildingIcon id={b.id} size={26} />
                    <span className="item-text">
                      <span className="name">{b.name}</span>
                      <span className="dims">{dims}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      )}
    </aside>
  )
}

const round = (v: number) => Math.round(v * 10) / 10

function tooltip(b: Building) {
  const lines = [b.name]
  if (b.description) lines.push('', b.description)
  if (b.powerMW) lines.push('', i18n.t('palette.consumption', { mw: b.powerMW }))
  if (b.cost.length)
    lines.push(
      '',
      i18n.t('palette.cost', { list: b.cost.map((c) => `${c.amount} ${itemName(c.item)}`).join(', ') }) + (b.kind === 'hyper' ? i18n.t('palette.perMeter') : isPathKind(b.kind) ? i18n.t('palette.perTwoMeters') : ''),
    )
  return lines.join('\n')
}
