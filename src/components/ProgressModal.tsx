import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, recipesById, type Schematic } from '../data/gameData'
import { ALT_SCHEMATICS, HUB_SCHEMATICS, MAM_SCHEMATICS, PHASE_TIERS, SHOP_SCHEMATICS, maxTierForPhase, useProgress } from '../editor/progress'

type Tab = 'hub' | 'mam' | 'alt' | 'shop'

const buildingByRecipe = new Map(game.buildings.map((b) => [b.buildRecipe, b]))

/** Qué desbloquea un schematic, en texto corto. */
function unlocksText(s: Schematic) {
  const names = s.recipes
    .map((r) => buildingByRecipe.get(r)?.name ?? recipesById.get(r)?.name)
    .filter(Boolean) as string[]
  return [...new Set(names)].join(', ')
}

export default function ProgressModal({ onClose }: { onClose: () => void }) {
  const p = useProgress()
  const [tab, setTab] = useState<Tab>('hub')
  const unlocked = new Set(p.unlocked)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Mi progreso</h2>
          <label className="switch">
            <input type="checkbox" checked={p.enabled} onChange={(e) => p.setEnabled(e.target.checked)} />
            Filtrar la paleta y las recetas según lo desbloqueado
          </label>
          <button onClick={onClose}>Cerrar</button>
        </header>
        <nav className="tabs">
          {(
            [
              ['hub', 'HUB y fases'],
              ['mam', 'M.A.M.'],
              ['alt', 'Recetas alternativas'],
              ['shop', 'Tienda FLIPANTE'],
            ] as [Tab, string][]
          ).map(([id, name]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {name}
            </button>
          ))}
        </nav>
        <div className="modal-body">
          {tab === 'hub' && <HubTab unlocked={unlocked} />}
          {tab === 'mam' && <MamTab unlocked={unlocked} />}
          {tab === 'alt' && <ListTab list={ALT_SCHEMATICS} unlocked={unlocked} kind="alt" />}
          {tab === 'shop' && <ListTab list={SHOP_SCHEMATICS} unlocked={unlocked} kind="shop" />}
        </div>
      </div>
    </div>
  )
}

function Check({ s, unlocked, disabled }: { s: Schematic; unlocked: Set<string>; disabled?: boolean }) {
  const toggle = useProgress((x) => x.toggle)
  const text = unlocksText(s)
  return (
    <label className={'check' + (disabled ? ' disabled' : '')} title={text}>
      <input type="checkbox" checked={unlocked.has(s.id)} disabled={disabled} onChange={() => toggle(s.id)} />
      <span>
        {s.name}
        {text && <small>{text}</small>}
      </span>
    </label>
  )
}

function HubTab({ unlocked }: { unlocked: Set<string> }) {
  const { phase, setPhase, setMany } = useProgress()
  const maxTier = maxTierForPhase(phase)
  const allowedUpTo = HUB_SCHEMATICS.filter((s) => s.tier <= maxTier).map((s) => s.id)
  return (
    <>
      <div className="phase-row">
        <span>Fase del Ascensor espacial en la que estás:</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={phase === n ? 'active' : ''} onClick={() => setPhase(n)}>
            Fase {n}
          </button>
        ))}
        <button onClick={() => setMany(allowedUpTo, true)}>Marcar todos los hitos disponibles</button>
      </div>
      {[1, 2, 3, 4, 5].map((ph) => (
        <section key={ph} className={ph > phase ? 'locked' : ''}>
          <h3>
            Fase {ph}
            {ph > phase && ' · bloqueada'}
          </h3>
          {PHASE_TIERS[ph].map((tier) => {
            const list = HUB_SCHEMATICS.filter((s) => s.tier === tier)
            if (!list.length) return null
            const all = list.every((s) => unlocked.has(s.id))
            return (
              <div key={tier} className="tier">
                <div className="tier-head">
                  <b>{tier === 0 ? 'Nivel 0 · Mejoras del HUB' : `Nivel ${tier}`}</b>
                  <button disabled={ph > phase} onClick={() => setMany(list.map((s) => s.id), !all)}>
                    {all ? 'Desmarcar nivel' : 'Marcar nivel'}
                  </button>
                </div>
                <div className="checks">
                  {list.map((s) => (
                    <Check key={s.id} s={s} unlocked={unlocked} disabled={ph > phase} />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </>
  )
}

function MamTab({ unlocked }: { unlocked: Set<string> }) {
  const setMany = useProgress((x) => x.setMany)
  const trees = useMemo(() => {
    const m = new Map<string, Schematic[]>()
    for (const s of MAM_SCHEMATICS) {
      const k = s.mamTree ?? 'Otros'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return [...m]
  }, [])
  return (
    <>
      {trees.map(([tree, list]) => {
        const all = list.every((s) => unlocked.has(s.id))
        return (
          <section key={tree} className="tier">
            <div className="tier-head">
              <b>{tree}</b>
              <button onClick={() => setMany(list.map((s) => s.id), !all)}>{all ? 'Desmarcar árbol' : 'Marcar árbol'}</button>
            </div>
            <div className="checks">
              {list.map((s) => (
                <Check key={s.id} s={s} unlocked={unlocked} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function ListTab({ list, unlocked, kind }: { list: Schematic[]; unlocked: Set<string>; kind: 'alt' | 'shop' }) {
  const [q, setQ] = useState('')
  const setMany = useProgress((x) => x.setMany)
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase()
    return list
      .filter((s) => !f || s.name.toLowerCase().includes(f) || unlocksText(s).toLowerCase().includes(f))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [list, q])
  const count = list.filter((s) => unlocked.has(s.id)).length
  return (
    <>
      <div className="phase-row">
        <input className="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">
          {count} de {list.length} marcadas
        </span>
        <button onClick={() => setMany(filtered.map((s) => s.id), true)}>Marcar visibles</button>
        <button onClick={() => setMany(filtered.map((s) => s.id), false)}>Desmarcar visibles</button>
      </div>
      {kind === 'alt' && (
        <p className="muted">Las recetas alternativas se obtienen analizando discos duros en el M.A.M. Marca las que ya elegiste.</p>
      )}
      <div className="checks wide">
        {filtered.map((s) => (
          <AltCheck key={s.id} s={s} unlocked={unlocked} />
        ))}
      </div>
    </>
  )
}

/** Alternativa con un resumen de su receta (entradas → salidas). */
function AltCheck({ s, unlocked }: { s: Schematic; unlocked: Set<string> }) {
  const toggle = useProgress((x) => x.toggle)
  const r = s.recipes.map((id) => recipesById.get(id)).find(Boolean)
  const b = s.recipes.map((id) => buildingByRecipe.get(id)).find(Boolean)
  return (
    <label className="check">
      <input type="checkbox" checked={unlocked.has(s.id)} onChange={() => toggle(s.id)} />
      <span>
        {s.name}
        {r && (
          <small>
            {r.ingredients.map((i) => itemName(i.item)).join(' + ')} → {r.products.map((i) => itemName(i.item)).join(' + ')}
            {r.producedIn[0] && ` · ${buildingsById.get(r.producedIn[0])?.name}`}
          </small>
        )}
        {!r && b && <small>{b.name}</small>}
      </span>
    </label>
  )
}
