import { useMemo, useState } from 'react'
import { CATEGORIES, game, isPathKind, itemName, type Building } from '../data/gameData'
import { useEditor } from '../editor/store'

export default function Palette() {
  const { category, setCategory, startPlacing, startConveyor, placingId, conveyorId } = useEditor()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = game.buildings.filter((b) => (q ? b.name.toLowerCase().includes(q) : b.category === category))
    const map = new Map<string, Building[]>()
    for (const b of list) {
      const key = q ? b.subcategory : b.subcategory
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return [...map]
  }, [category, query])

  return (
    <aside className="palette">
      <nav className="cats">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className={c.id === category && !query ? 'active' : ''}
            onClick={() => {
              setQuery('')
              setCategory(c.id)
            }}
          >
            {c.name}
          </button>
        ))}
      </nav>
      <div className="items">
        <input className="search" placeholder="Buscar por estructura…" value={query} onChange={(e) => setQuery(e.target.value)} />
        {groups.map(([sub, list], gi) => (
          <section key={sub}>
            <h3>
              {gi + 1}. {sub}
            </h3>
            <div className="grid">
              {list.map((b) => {
                const path = isPathKind(b.kind)
                const f = b.footprint
                const dims = path
                  ? b.itemsPerMinute
                    ? `${b.itemsPerMinute}/min`
                    : `${b.flowPerMinute} m³/min`
                  : f
                    ? `${round(f.maxX - f.minX)} × ${round(f.maxY - f.minY)} m`
                    : ''
                const active = placingId === b.id || conveyorId === b.id
                return (
                  <button
                    key={b.id}
                    className={'item' + (active ? ' active' : '')}
                    title={tooltip(b) + (path ? '\n\nClic en un puerto o en el suelo para empezar y otro clic para terminar el tramo.' : '')}
                    onClick={() => (path ? startConveyor(b.id) : startPlacing(b.id))}
                  >
                    <span className="name">{b.name}</span>
                    <span className="dims">{dims}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </aside>
  )
}

const round = (v: number) => Math.round(v * 10) / 10

function tooltip(b: Building) {
  const lines = [b.name]
  if (b.description) lines.push('', b.description)
  if (b.powerMW) lines.push('', `Consumo: ${b.powerMW} MW`)
  if (b.cost.length)
    lines.push(
      '',
      'Coste: ' + b.cost.map((c) => `${c.amount} ${itemName(c.item)}`).join(', ') + (isPathKind(b.kind) ? ' (por cada 2 m aprox.)' : ''),
    )
  return lines.join('\n')
}
