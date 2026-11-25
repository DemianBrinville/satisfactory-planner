import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, recipesById, type Building, type Recipe } from '../data/gameData'
import { summarize } from '../editor/costs'
import { conveyorCost, pathLength } from '../editor/conveyors'
import { PURITY_NAME, computeFlows, extractionRate, extractorResources, recipesFor, type NodeFlow } from '../editor/flow'
import { useAvailability } from '../editor/progress'
import { PriorityMergerPanel, RoutePanel, SplitterPanel, StoragePanel } from './LogisticsPanels'
import { vehicleForStation } from '../editor/transport'
import ConnectorPanel from './ConnectorPanel'
import Production from './Production'
import { GridLine } from './PlannerCanvas'
import { canLinkWorld, computeGrids } from '../editor/power'
import { isVerticalConnector } from '../editor/geometry'
import { useEditor, type PlacedEntity, type Purity } from '../editor/store'

const fmt = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 2 })
const pct = (clock: number) => `${Math.round(clock * 10000) / 100} %`

export default function SidePanel() {
  const { entities, conveyors, selection, placingId, placingRot, tool, conveyorId, floorHeight } = useEditor()
  const wires = useEditor((s) => s.wires) ?? []
  const rails = useEditor((s) => s.rails) ?? []
  const selRails = rails.filter((r) => selection.includes(r.uid))
  const selWires = useMemo(
    () => wires.filter((w) => selection.includes(w.uid) || (selection.includes(w.from) && selection.includes(w.to))),
    [wires, selection],
  )
  const selEntities = useMemo(() => entities.filter((e) => selection.includes(e.uid)), [entities, selection])
  const selConveyors = useMemo(() => conveyors.filter((c) => selection.includes(c.uid)), [conveyors, selection])
  const summary = useMemo(
    () => summarize(selEntities, selConveyors, floorHeight, selWires, entities, selRails),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selEntities, selConveyors, floorHeight, selWires, entities, selection, rails],
  )
  const total = useMemo(
    () => summarize(entities, conveyors, floorHeight, wires, entities, rails),
    [entities, conveyors, floorHeight, wires, rails],
  )
  const routes = useEditor((s) => s.routes) ?? []
  const flows = useMemo(() => computeFlows(entities, conveyors, routes, floorHeight), [entities, conveyors, routes, floorHeight])
  const powerSettings = useEditor((s) => s.power)
  const power = useMemo(() => computeGrids(entities, wires, flows, powerSettings), [entities, wires, flows, powerSettings])
  const placing = tool === 'place' && placingId ? buildingsById.get(placingId) : null
  const conv = tool === 'conveyor' && conveyorId ? buildingsById.get(conveyorId) : null
  const single = selEntities.length === 1 && selConveyors.length === 0 ? selEntities[0] : null
  const singleB = single ? buildingsById.get(single.buildingId) : null
  const configurable =
    singleB && (singleB.kind === 'machine' || singleB.kind === 'miner' || singleB.kind === 'extractor' || singleB.kind === 'generator')
  const selRoute = (routes.find((r) => selection.includes(r.uid)) ?? null) as import('../editor/transport').Route | null
  const hasSelection = selEntities.length + selConveyors.length + selWires.length + selRails.length > 0

  return (
    <aside className="side">
      {placing && (
        <section>
          <h2>Construyendo: {placing.name}</h2>
          <p className="muted">
            Rotación {placingRot}° · <kbd>R</kbd> girar · clic derecho o <kbd>Esc</kbd> para salir
          </p>
          {placing.description && <p className="desc">{placing.description}</p>}
          <Cost items={placing.cost} />
        </section>
      )}
      {conv && (
        <section>
          <h2>Trazando: {conv.name}</h2>
          <p className="muted">
            Capacidad {conv.itemsPerMinute ? `${conv.itemsPerMinute}/min` : `${conv.flowPerMinute} m³/min`}. Clic en un puerto (o en el suelo, que
            crea un {conv.kind === 'pipe' ? 'soporte' : 'poste'}) para empezar y otro clic para terminar. Si terminas en el suelo, el trazado sigue
            desde ahí. Máximo 56 m por tramo.
          </p>
        </section>
      )}
      {tool === 'paste' && (
        <section>
          <h2>Colocando copia</h2>
          <p className="muted">
            Clic para colocar · <kbd>R</kbd> girar · <kbd>Esc</kbd> salir
          </p>
        </section>
      )}

      {single && singleB && /SplitterSmart|SplitterProgrammable/.test(singleB.id) && <SplitterPanel e={single} b={singleB} />}
      {single && singleB && isVerticalConnector(singleB.id) && <ConnectorPanel e={single} b={singleB} />}
      {selRoute && <RoutePanel r={selRoute} entities={entities} floorHeight={floorHeight} flow={flows.edges.get(selRoute.uid)} />}
      {single && singleB && vehicleForStation(singleB.id) && (
        <section>
          <button onClick={() => useEditor.getState().startRoute(vehicleForStation(singleB.id)!, single.uid)}>
            Crear ruta desde esta estación
          </button>
          <p className="muted">Después haz clic en la estación de destino.</p>
        </section>
      )}
      {single && singleB && /StorageContainer|PipeStorageTank|IndustrialTank/.test(singleB.id) && (
        <StoragePanel
          e={single}
          b={singleB}
          inflow={sumFlows(conveyors.filter((c) => c.to.uid === single.uid), flows)}
          outflow={sumFlows(conveyors.filter((c) => c.from.uid === single.uid), flows)}
        />
      )}
      {single && singleB && /MergerPriority/.test(singleB.id) && <PriorityMergerPanel e={single} b={singleB} />}
      {single && singleB && configurable && (
        <MachinePanel e={single} b={singleB} node={flows.nodes.get(single.uid)} />
      )}

      {hasSelection ? (
        <section>
          <h2>Selección ({selEntities.length + selConveyors.length + selWires.length})</h2>
          {single && singleB && <GridLine e={single} b={singleB} power={power} />}
          {single && singleB && canLinkWorld(singleB) && !power.infinite && (
            <label className="switch">
              <input
                type="checkbox"
                checked={!!single.worldLink}
                onChange={(ev) => useEditor.getState().updateEntity(single.uid, { worldLink: ev.target.checked })}
              />
              Conectado a la red de mi mundo
            </label>
          )}
          <Counts summary={summary} />
          <h3>Materiales</h3>
          <Cost items={summary.materials} />
          <Power s={summary} />
          <p className="muted">
            <kbd>R</kbd> girar · <kbd>Supr</kbd> borrar · <kbd>Ctrl+X</kbd> mover · <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copiar · clic derecho:
            opciones
          </p>
        </section>
      ) : (
        tool === 'select' && (
          <section>
            <h2>Plano completo</h2>
            <p className="muted">
              {entities.length} estructuras · {conveyors.length} tramos. Arrastra sobre el plano para seleccionar un área y ver sus materiales.
            </p>
            <Counts summary={total} />
            {power.grids.length > 0 && (
              <>
                <h3>Redes eléctricas</h3>
                {power.grids.map((g) => (
                  <div key={g.id} className={'flowline' + (g.consumption > g.generation + 1e-6 ? ' bad' : '')}>
                    <span>
                      Red {g.id} ({g.members.length})
                    </span>
                    <span>
                      {fmt(g.consumption)} / {fmt(g.generation)} MW
                    </span>
                  </div>
                ))}
              </>
            )}
            <h3>Materiales</h3>
            <Cost items={total.materials} />
            <Power s={total} />
          </section>
        )
      )}

      <section className="help">
        <h3>Controles</h3>
        <p>
          Rueda: zoom · Botón central o <kbd>Espacio</kbd>+arrastrar: mover vista · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd>: deshacer/rehacer ·{' '}
          <kbd>Shift</kbd>+clic: sumar a la selección · clic derecho: opciones
        </p>
        <p>
          Cintas: <span className="ok">verde</span> justo, <span className="warn">amarillo</span> sobra material, <span className="bad">rojo</span>{' '}
          falta material.
        </p>
      </section>
    </aside>
  )
}

function sumFlows(list: { uid: string }[], flows: ReturnType<typeof computeFlows>) {
  const m = new Map<string, number>()
  for (const c of list) for (const [i, v] of flows.edges.get(c.uid)?.flow ?? []) m.set(i, (m.get(i) ?? 0) + v)
  return m
}

function Counts({ summary }: { summary: ReturnType<typeof summarize> }) {
  return (
    <ul className="counts">
      {summary.counts.map((c) => (
        <li key={c.buildingId}>
          <span>{buildingsById.get(c.buildingId)?.name}</span>
          <b>{c.meters ? `${fmt(c.meters)} m (${c.count})` : `×${c.count}`}</b>
        </li>
      ))}
    </ul>
  )
}

function Power({ s }: { s: ReturnType<typeof summarize> }) {
  if (s.powerMW <= 0 && s.powerGenMW <= 0) return null
  return (
    <p className="muted">
      Consumo {fmt(s.powerMW)} MW{s.powerGenMW > 0 && ` · Genera ${fmt(s.powerGenMW)} MW`}
    </p>
  )
}

function Cost({ items }: { items: { item: string; amount: number }[] }) {
  if (!items.length) return <p className="muted">Sin materiales.</p>
  return (
    <ul className="cost">
      {items.map((c) => (
        <li key={c.item}>
          <span>{itemName(c.item)}</span>
          <b>{fmt(c.amount)}</b>
        </li>
      ))}
    </ul>
  )
}

// ---------------- configuración de máquinas ----------------

function MachinePanel({ e, b, node }: { e: PlacedEntity; b: Building; node?: NodeFlow }) {
  const update = useEditor((s) => s.updateEntity)
  const clock = e.clock ?? 1
  const recipe = e.recipeId ? recipesById.get(e.recipeId) : undefined
  const [picking, setPicking] = useState(!recipe)

  const setClock = (v: number) => update(e.uid, { clock: Math.min(2.5, Math.max(0.01, Math.round(v * 10000) / 10000)) })

  // sugerencia: bajar el reloj hasta lo que aceptan las salidas o lo que permiten las entradas
  const suggestion = node ? Math.min(node.inputLimited, node.outputLimited) : null
  const canUnderclock = suggestion !== null && suggestion > 0.0001 && suggestion < clock - 0.0001

  return (
    <section className="machine">
      <h2>{b.name}</h2>

      {(b.kind === 'miner' || b.kind === 'extractor') && <ExtractorConfig e={e} b={b} />}
      {b.kind === 'generator' && <GeneratorConfig e={e} b={b} />}

      {b.kind === 'machine' && (
        <>
          <h3>Receta</h3>
          {recipe && !picking ? (
            <div className="recipe-current">
              <RecipeCard r={recipe} clock={clock} />
              <button onClick={() => setPicking(true)}>Cambiar receta</button>
            </div>
          ) : (
            <RecipePicker
              buildingId={b.id}
              current={e.recipeId}
              onPick={(id) => {
                update(e.uid, { recipeId: id })
                setPicking(false)
              }}
            />
          )}
        </>
      )}

      <h3>Velocidad de reloj</h3>
      <div className="clock">
        <input
          type="number"
          min={1}
          max={250}
          step={0.01}
          value={Math.round(clock * 10000) / 100}
          onChange={(ev) => setClock(Number(ev.target.value) / 100)}
        />
        <span>%</span>
        <button onClick={() => setClock(1)}>100 %</button>
      </div>
      {clock > 1 && (
        <p className="warn">
          Overclock: necesita {Math.ceil((clock - 1) / 0.5)} fragmento(s) de energía. Úsalo solo si no hay alternativa.
        </p>
      )}

      {(b.somersloopSlots ?? 0) > 0 && (
        <>
          <h3>Amplificación (somersloops)</h3>
          <div className="segmented">
            {Array.from({ length: (b.somersloopSlots ?? 0) + 1 }, (_, n) => (
              <button key={n} className={(e.somersloops ?? 0) === n ? 'active' : ''} onClick={() => update(e.uid, { somersloops: n })}>
                {n}
              </button>
            ))}
          </div>
          {(e.somersloops ?? 0) > 0 && (
            <p className="muted">
              Produce +{Math.round(((e.somersloops ?? 0) / (b.somersloopSlots ?? 1)) * 100)} % con las mismas entradas; el consumo eléctrico se
              multiplica por {fmt(Math.pow(1 + (e.somersloops ?? 0) / (b.somersloopSlots ?? 1), 2))}.
            </p>
          )}
        </>
      )}

      {node && (
        <>
          <h3>Producción: {pct(node.effective)}</h3>
          <Production n={node} />
          {canUnderclock && suggestion !== null && (
            <div className="hint">
              {node.outputLimited < node.inputLimited
                ? 'Lo que está conectado después no consume todo lo que produce.'
                : 'No le llega suficiente material para trabajar al 100 %.'}{' '}
              Bajando el reloj a <b>{pct(suggestion)}</b> trabaja sin desperdicio.
              <button onClick={() => setClock(suggestion)}>Aplicar {pct(suggestion)}</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ExtractorConfig({ e, b }: { e: PlacedEntity; b: Building }) {
  const update = useEditor((s) => s.updateEntity)
  const resources = extractorResources(b)
  const resource = e.resource ?? resources[0]
  const purityApplies = !/WaterPump/.test(b.id)
  return (
    <>
      <h3>Yacimiento</h3>
      {resources.length > 1 && (
        <select value={resource} onChange={(ev) => update(e.uid, { resource: ev.target.value })}>
          {resources.map((r) => (
            <option key={r} value={r}>
              {itemName(r)}
            </option>
          ))}
        </select>
      )}
      {resources.length === 1 && <p>{itemName(resource)}</p>}
      {purityApplies && (
        <div className="segmented">
          {(['impure', 'normal', 'pure'] as Purity[]).map((p) => (
            <button key={p} className={(e.purity ?? 'normal') === p ? 'active' : ''} onClick={() => update(e.uid, { purity: p })}>
              {PURITY_NAME[p]}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        Produce <b>{fmt(extractionRate(e, b))}</b> {game.items[resource]?.form === 'solid' ? '/min' : 'm³/min'}
      </p>
    </>
  )
}

function GeneratorConfig({ e, b }: { e: PlacedEntity; b: Building & { fuels?: { fuel: string }[] } }) {
  const update = useEditor((s) => s.updateEntity)
  const fuels = (b as { fuels?: { fuel: string }[] }).fuels?.map((f) => f.fuel).filter((f) => game.items[f]) ?? []
  if (!fuels.length) return <p className="muted">Genera {b.powerGenMW} MW.</p>
  const fuel = e.resource ?? ''
  const energy = fuel ? game.items[fuel]?.energyMJ ?? 0 : 0
  return (
    <>
      <h3>Combustible</h3>
      <select value={fuel} onChange={(ev) => update(e.uid, { resource: ev.target.value || undefined })}>
        <option value="">— elegir —</option>
        {fuels.map((f) => (
          <option key={f} value={f}>
            {itemName(f)}
          </option>
        ))}
      </select>
      {energy > 0 && (
        <p className="muted">
          Consume {fmt(((b.powerGenMW * 60) / energy) * (e.clock ?? 1))}/min para generar {fmt(b.powerGenMW * (e.clock ?? 1))} MW.
        </p>
      )}
    </>
  )
}

function RecipePicker({ buildingId, current, onPick }: { buildingId: string; current?: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)
  const avail = useAvailability()
  const all = recipesFor(buildingId)
  const hidden = avail.enabled && !showAll ? all.filter((r) => !avail.recipe(r)).length : 0
  const list = useMemo(() => {
    const f = q.trim().toLowerCase()
    return all
      .filter((r) => showAll || avail.recipe(r))
      .filter((r) => !f || r.name.toLowerCase().includes(f) || r.products.some((p) => itemName(p.item).toLowerCase().includes(f)))
      .sort((a, b) => Number(a.alternate) - Number(b.alternate) || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingId, q, showAll, avail.enabled, avail.recipe])
  return (
    <div className="recipe-picker">
      <input className="search" placeholder="Buscar receta…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {avail.enabled && (
        <p className="hidden-note">
          {hidden > 0 && `${hidden} receta(s) ocultas por tu progreso. `}
          <label>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> mostrar todas
          </label>
        </p>
      )}
      <div className="recipe-list">
        {list.map((r) => (
          <button key={r.id} className={'recipe' + (r.id === current ? ' active' : '')} onClick={() => onPick(r.id)}>
            <RecipeCard r={r} clock={1} />
          </button>
        ))}
      </div>
    </div>
  )
}

function RecipeCard({ r, clock }: { r: Recipe; clock: number }) {
  const perMin = (60 / r.duration) * clock
  return (
    <div className="recipe-card">
      <div className="recipe-name">
        {r.name}
        {r.alternate && <span className="tag">Alternativa</span>}
      </div>
      <div className="recipe-io">
        <div>
          {r.ingredients.map((i) => (
            <div key={i.item}>
              <b>{fmt(i.amount * perMin)}</b> {itemName(i.item)}
            </div>
          ))}
        </div>
        <span className="arrow">→</span>
        <div>
          {r.products.map((p) => (
            <div key={p.item}>
              <b>{fmt(p.amount * perMin)}</b> {itemName(p.item)}
            </div>
          ))}
        </div>
      </div>
      <div className="muted small">por minuto · ciclo de {fmt(r.duration)} s</div>
    </div>
  )
}

// el panel de una cinta seleccionada se muestra en el tooltip; aquí solo su costo
export function ConveyorInfo({ buildingId, points }: { buildingId: string; points: { x: number; y: number }[] }) {
  return (
    <p className="muted">
      {fmt(pathLength(points))} m · {conveyorCost({ buildingId, points }).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}
    </p>
  )
}
