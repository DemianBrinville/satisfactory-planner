import { fmtPct } from '../i18n/format'
import i18n from '../i18n'
import { Trans, useTranslation } from 'react-i18next'
import { locale } from '../i18n/format'
import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, recipePowerRange, recipesById, type Building, type Recipe } from '../data/gameData'
import { summarize } from '../editor/costs'
import { conveyorCost, pathLength } from '../editor/conveyors'
import { computeFlows, extractionRate, extractorResources, recipesFor, type NodeFlow } from '../editor/flow'
import { useAvailability } from '../editor/progress'
import { PriorityMergerPanel, RoutePanel, SplitterPanel, StoragePanel } from './LogisticsPanels'
import { vehicleForStation } from '../editor/transport'
import ConnectorPanel from './ConnectorPanel'
import Production, { ClockAdviceText, clockAdvice } from './Production'
import { GridLine } from './PlannerCanvas'
import {
  AUGMENTER_BOOST,
  AUGMENTER_FUEL_BOOST,
  AUGMENTER_FUEL_RATE,
  AUGMENTER_MW,
  augmenterBoost,
  augmenterFuel,
  BATTERY_CHARGE_MW,
  BATTERY_MWH,
  batteryState,
  canLinkWorld,
  computeGrids,
  consumptionMW,
  isAugmenter,
  isBattery,
  isPowerSwitch,
  isPrioritySwitch,
} from '../editor/power'
import { isVerticalConnector } from '../editor/geometry'
import { groupOf, useEditor, type PlacedEntity, type Purity } from '../editor/store'
import { designerContents, designerZone } from '../editor/designer'
import { useBlocks } from '../cloud/blocks'
import { NONE } from '../editor/store'
import { ItemLabel } from './GameIcons'
import { PlatformPanel, StationPanel, TrainPanel } from './TrainPanels'
import { isPlatform, isTimetable, isTrainStation } from '../editor/trains'
import { defaultPoleHeight, poleHeights } from '../editor/validation'
import { spotPatch, spotUnder } from '../editor/worldMap'

const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 2 })
const pct = (clock: number) => fmtPct(clock)

export default function SidePanel() {
  const { t } = useTranslation()
  const { entities, conveyors, selection, placingId, placingRot, tool, conveyorId, floorHeight } = useEditor()
  const wires = useEditor((s) => s.wires) ?? NONE
  const rails = useEditor((s) => s.rails) ?? NONE
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
  const routes = useEditor((s) => s.routes) ?? NONE
  const flows = useMemo(() => computeFlows(entities, conveyors, routes, floorHeight, rails), [entities, conveyors, routes, floorHeight, rails])
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
          <h2>{t('side.building', { name: placing.name })}</h2>
          <p className="muted">
            <Trans i18nKey="side.buildingHelp" values={{ rot: placingRot }} components={{ kbd: <kbd /> }} />
          </p>
          {placing.description && <p className="desc">{placing.description}</p>}
          <Cost items={placing.cost} />
        </section>
      )}
      {conv && (
        <section>
          <h2>{t('side.drawing', { name: conv.name })}</h2>
          <p className="muted">
            {conv.kind === 'hyper'
              ? t('side.drawingHelpHyper')
              : t(conv.kind === 'pipe' ? 'side.drawingHelpPipe' : 'side.drawingHelpBelt', {
                  cap: conv.itemsPerMinute ? `${conv.itemsPerMinute}/min` : `${conv.flowPerMinute} m³/min`,
                })}
          </p>
        </section>
      )}
      {tool === 'paste' && (
        <section>
          <h2>{t('side.pasting')}</h2>
          <p className="muted">
            <Trans i18nKey="side.pastingHelp" components={{ kbd: <kbd /> }} />
          </p>
        </section>
      )}

      {single && singleB && /SplitterSmart|SplitterProgrammable/.test(singleB.id) && <SplitterPanel e={single} b={singleB} />}
      {single && singleB && isVerticalConnector(singleB.id) && <ConnectorPanel e={single} b={singleB} />}
      {single && singleB && poleHeights(singleB.id, floorHeight ?? 8) && (
        <PoleHeight e={single} options={poleHeights(singleB.id, floorHeight ?? 8)!} />
      )}
      {selRoute &&
        (isTimetable(selRoute) ? (
          <TrainPanel r={selRoute} flows={flows} />
        ) : (
          <RoutePanel r={selRoute} entities={entities} floorHeight={floorHeight} flow={flows.edges.get(selRoute.uid)} />
        ))}
      {single && singleB && isTrainStation(singleB.id) && <StationPanel e={single} />}
      {single && singleB && isPlatform(singleB.id) && <PlatformPanel e={single} />}
      {single && singleB && vehicleForStation(singleB.id) && (
        <section>
          <button onClick={() => useEditor.getState().startRoute(vehicleForStation(singleB.id)!, single.uid)}>
            {t('side.createRoute')}
          </button>
          <p className="muted">{t('side.createRouteHint')}</p>
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
      {single && singleB && isAugmenter(singleB.id) && <AugmenterPanel e={single} flows={flows} power={power} />}
      {single && singleB && isBattery(singleB.id) && <BatteryPanel e={single} power={power} />}
      {single && singleB && isPowerSwitch(singleB.id) && <SwitchPanel e={single} power={power} />}
      {single && singleB && singleB.kind === 'valve' && <ValvePanel e={single} flows={flows} />}
      {single && singleB && singleB.kind === 'designer' && <DesignerPanel e={single} />}
      {single && singleB && configurable && (
        <MachinePanel e={single} b={singleB} node={flows.nodes.get(single.uid)} />
      )}

      {hasSelection ? (
        <section>
          <h2>{t('side.selection', { n: selEntities.length + selConveyors.length + selWires.length })}</h2>
          {single && singleB && <GridLine e={single} b={singleB} power={power} />}
          {single && singleB && canLinkWorld(singleB) && !power.infinite && (
            <label className="switch">
              <input
                type="checkbox"
                checked={!!single.worldLink}
                onChange={(ev) => useEditor.getState().updateEntity(single.uid, { worldLink: ev.target.checked })}
              />
              {t('side.worldLink')}
            </label>
          )}
          <Counts summary={summary} />
          <h3>{t('side.materials')}</h3>
          <Cost items={summary.materials} />
          <Power s={summary} />
          <p className="muted">
            <Trans i18nKey="side.selectionHelp" components={{ kbd: <kbd /> }} />
          </p>
        </section>
      ) : (
        tool === 'select' && (
          <section>
            <h2>{t('side.wholePlan')}</h2>
            <p className="muted">
              {t('side.wholePlanSummary', { structures: entities.length, segments: conveyors.length })}
            </p>
            <Counts summary={total} />
            {power.grids.length > 0 && (
              <>
                <h3>{t('side.grids')}</h3>
                {power.grids.map((g) => (
                  <div key={g.id} className={'flowline' + (g.consumption > g.generation + 1e-6 ? ' bad' : '')}>
                    <span>
                      {t('side.grid', { id: g.id, n: g.members.length })}
                    </span>
                    <span>
                      {fmt(g.consumption)} / {fmt(g.generation)} MW
                    </span>
                  </div>
                ))}
              </>
            )}
            <h3>{t('side.materials')}</h3>
            <Cost items={total.materials} />
            <Power s={total} />
          </section>
        )
      )}

      <section className="help">
        <h3>{t('side.controls')}</h3>
        <p>
          <Trans i18nKey="side.controlsView" components={{ kbd: <kbd /> }} />
        </p>
        <p>
          {t('side.controlsBuild')}
        </p>
        <p>
          <Trans
            i18nKey="side.controlsColors"
            components={{ ok: <span className="ok" />, warn: <span className="warn" />, bad: <span className="bad" /> }}
          />
        </p>
      </section>
    </aside>
  )
}

/** Altura de un poste de cinta: define la pendiente de las cintas que llegan y si pasan por encima de las máquinas. */
function PoleHeight({ e, options }: { e: PlacedEntity; options: number[] }) {
  const { t } = useTranslation()
  const h = e.height ?? defaultPoleHeight(e.buildingId)
  return (
    <section>
      <h3>{t('side.poleHeight')}</h3>
      <div className="segmented small">
        {options.map((o) => (
          <button key={o} className={o === h ? 'active' : ''} onClick={() => useEditor.getState().updateEntity(e.uid, { height: o })}>
            {o} m
          </button>
        ))}
      </div>
      <p className="muted small">{t('side.poleHeightHint')}</p>
    </section>
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
      {i18n.t('side.powerUse', { mw: fmt(s.powerMW) })}
      {s.powerGenMW > 0 && i18n.t('side.powerGen', { mw: fmt(s.powerGenMW) })}
    </p>
  )
}

function Cost({ items }: { items: { item: string; amount: number }[] }) {
  if (!items.length) return <p className="muted">{i18n.t('side.noMaterials')}</p>
  return (
    <ul className="cost">
      {items.map((c) => (
        <li key={c.item}>
          <ItemLabel item={c.item} name={itemName(c.item)} />
          <b>{fmt(c.amount)}</b>
        </li>
      ))}
    </ul>
  )
}

// ---------------- configuración de máquinas ----------------

function MachinePanel({ e, b, node }: { e: PlacedEntity; b: Building; node?: NodeFlow }) {
  const { t } = useTranslation()
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
          <h3>{t('machine.recipe')}</h3>
          {recipe && !picking ? (
            <div className="recipe-current">
              <RecipeCard r={recipe} clock={clock} />
              <button onClick={() => setPicking(true)}>{t('machine.changeRecipe')}</button>
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

      {recipe && recipePowerRange(recipe) && <VariablePowerNote e={e} b={b} range={recipePowerRange(recipe)!} />}

      <h3>{t('machine.clock')}</h3>
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
          {t('machine.overclock', { n: Math.ceil((clock - 1) / 0.5) })}
        </p>
      )}

      {(b.somersloopSlots ?? 0) > 0 && (
        <>
          <h3>{t('machine.somersloops')}</h3>
          <div className="segmented">
            {Array.from({ length: (b.somersloopSlots ?? 0) + 1 }, (_, n) => (
              <button key={n} className={(e.somersloops ?? 0) === n ? 'active' : ''} onClick={() => update(e.uid, { somersloops: n })}>
                {n}
              </button>
            ))}
          </div>
          {(e.somersloops ?? 0) > 0 && (
            <p className="muted">
              {t('machine.somersloopsHelp', {
                pct: Math.round(((e.somersloops ?? 0) / (b.somersloopSlots ?? 1)) * 100),
                mult: fmt(Math.pow(1 + (e.somersloops ?? 0) / (b.somersloopSlots ?? 1), 2)),
              })}
            </p>
          )}
        </>
      )}

      {node && (
        <>
          <h3>{t('machine.production', { pct: pct(node.effective) })}</h3>
          <Production n={node} />
          <ClockAdviceText a={clockAdvice(node, clock)} onApply={setClock} />
          {!clockAdvice(node, clock) && node.bottleneck && canUnderclock && suggestion !== null && (
            <div className="hint">
              {node.outputLimited < node.inputLimited ? t('machine.outputSlack') : t('machine.inputShort')}{' '}
              <Trans i18nKey="machine.underclockHint" values={{ pct: pct(suggestion) }} components={{ b: <b /> }} />
              <button onClick={() => setClock(suggestion)}>{t('common.apply', { pct: pct(suggestion) })}</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** Horas en texto: "45 min", "2 h 10 min". */
export function fmtHours(h: number): string {
  const m = Math.round(h * 60)
  if (m < 60) return i18n.t('battery.minutes', { m })
  const hh = Math.floor(m / 60)
  return m % 60 ? i18n.t('battery.hoursMinutes', { h: hh, m: m % 60 }) : i18n.t('battery.hours', { h: hh })
}

/** Diseñador de planos: zona de construcción, lo que hay adentro y lo que se sale; guardar lo de adentro como bloque. */
function DesignerPanel({ e }: { e: PlacedEntity }) {
  const { t } = useTranslation()
  const entities = useEditor((s) => s.entities)
  const floorHeight = useEditor((s) => s.floorHeight) ?? 8
  const zone = designerZone(e)
  const { inside, outside } = useMemo(() => designerContents(e, entities, floorHeight), [e, entities, floorHeight])
  const uids = inside.map((x) => x.uid)
  return (
    <section className="machine">
      <h2>{buildingsById.get(e.buildingId)?.name}</h2>
      {zone && <p className="muted small">{t('designer.help', { m: zone.height, n: zone.height / 8 })}</p>}
      <p className="small">{t('designer.inside', { count: inside.length })}</p>
      {outside.length > 0 && <p className="warn small">{t('designer.outside', { count: outside.length })}</p>}
      {inside.length > 0 && (
        <div className="modal-actions">
          <button className="btn" onClick={() => useEditor.getState().select(uids)}>
            {t('designer.select')}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const s = useEditor.getState()
              const g = groupOf(uids, s.entities, s.conveyors, s.wires ?? NONE, s.rails ?? NONE)
              if (g) useBlocks.getState().setSaving(g)
            }}
          >
            {t('designer.saveBlock')}
          </button>
        </div>
      )}
    </section>
  )
}

/** Válvula: caudal máximo que deja pasar y lo que pasa en este momento. */
function ValvePanel({ e, flows }: { e: PlacedEntity; flows: ReturnType<typeof computeFlows> }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const conveyors = useEditor((s) => s.conveyors)
  const out = conveyors.filter((c) => c.from.uid === e.uid)
  const passing = out.reduce((a, c) => a + [...(flows.edges.get(c.uid)?.flow.values() ?? [])].reduce((x, y) => x + y, 0), 0)
  const limited = e.flowLimit !== undefined
  return (
    <section className="machine">
      <h2>{buildingsById.get(e.buildingId)?.name}</h2>
      <p className="muted small">{t('valve.help')}</p>
      <label className="switch">
        <input type="checkbox" checked={limited} onChange={(ev) => update(e.uid, { flowLimit: ev.target.checked ? 300 : undefined })} />
        {t('valve.limit')}
      </label>
      {limited && (
        <div className="flowline">
          <input type="range" min={0} max={600} step={5} value={e.flowLimit} onChange={(ev) => update(e.uid, { flowLimit: Number(ev.target.value) })} />
          <span>
            <input
              className="small-input"
              type="number"
              min={0}
              max={600}
              value={e.flowLimit}
              onChange={(ev) => update(e.uid, { flowLimit: Math.max(0, Math.min(600, Number(ev.target.value) || 0)) })}
            />{' '}
            m³/min
          </span>
        </div>
      )}
      {out.length > 0 && <p className="muted small">{t('valve.passing', { n: fmt(passing) })}</p>}
    </section>
  )
}

/** Interruptor de energía: encendido o apagado y, si es de prioridad, su grupo de corte. */
function SwitchPanel({ e, power }: { e: PlacedEntity; power: ReturnType<typeof computeGrids> }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const prio = isPrioritySwitch(e.buildingId)
  const on = e.switchOn !== false
  const cut = power.autoOff.has(e.uid)
  return (
    <section className="machine">
      <h2>{buildingsById.get(e.buildingId)?.name}</h2>
      <p className="muted small">{t(prio ? 'switch.helpPriority' : 'switch.help')}</p>
      <div className="segmented">
        <button className={on ? 'active' : ''} onClick={() => update(e.uid, { switchOn: undefined })}>
          {t('switch.on')}
        </button>
        <button className={!on ? 'active' : ''} onClick={() => update(e.uid, { switchOn: false })}>
          {t('switch.off')}
        </button>
      </div>
      {cut && <p className="warn small">{t('switch.autoOff')}</p>}
      {prio && (
        <>
          <h3>{t('switch.group')}</h3>
          <select value={e.circuitPriority ?? ''} onChange={(ev) => update(e.uid, { circuitPriority: ev.target.value ? Number(ev.target.value) : undefined })}>
            <option value="">{t('switch.noGroup')}</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {t('switch.groupN', { n })}
              </option>
            ))}
          </select>
          <p className="muted small">{t('switch.groupHelp')}</p>
        </>
      )}
      <p className="muted small">{t('switch.gameNote')}</p>
    </section>
  )
}

/** Batería: capacidad de su red y si se carga, se descarga o cubre los picos. */
function BatteryPanel({ e, power }: { e: PlacedEntity; power: ReturnType<typeof computeGrids> }) {
  const { t } = useTranslation()
  const gid = power.gridOf.get(e.uid)
  const g = gid ? power.grids.find((x) => x.id === gid) : null
  const st = g ? batteryState(g) : null
  return (
    <section className="machine">
      <h2>{buildingsById.get(e.buildingId)?.name}</h2>
      <p className="muted small">{t('battery.help', { mwh: BATTERY_MWH, mw: BATTERY_CHARGE_MW })}</p>
      {power.infinite ? (
        <p className="muted small">{t('battery.infinite')}</p>
      ) : !g || !st ? (
        <p className="warn small">{t('battery.noGrid')}</p>
      ) : (
        <>
          <div className="flowline">
            <span>{t('battery.gridStorage', { id: g.id, count: g.batteries })}</span>
            <b>{fmt(st.capacity)} MWh</b>
          </div>
          {st.charge > 0 && <p className="ok small">{t('battery.charging', { mw: fmt(st.charge), time: fmtHours(st.hours!) })}</p>}
          {st.drain > 0 && <p className="bad small">{t('battery.draining', { mw: fmt(st.drain), time: fmtHours(st.hours!) })}</p>}
          {!st.charge && !st.drain && <p className="muted small">{t('battery.idle')}</p>}
          {st.peakGap > 0 && st.drain === 0 && <p className="muted small">{t('battery.peaks', { mw: fmt(st.peakGap) })}</p>}
        </>
      )}
    </section>
  )
}

/** Amplificador de energía alienígena: lo que genera, cuánto aumenta su red y si recibe matrices. */
function AugmenterPanel({ e, flows, power }: { e: PlacedEntity; flows: ReturnType<typeof computeFlows>; power: ReturnType<typeof computeGrids> }) {
  const { t } = useTranslation()
  const node = flows.nodes.get(e.uid)
  const fuel = augmenterFuel(e, flows)
  const boost = augmenterBoost(e, flows)
  const gid = power.gridOf.get(e.uid)
  const g = gid ? power.grids.find((x) => x.id === gid) : null
  return (
    <section className="machine">
      <h2>{buildingsById.get(e.buildingId)?.name}</h2>
      <p className="muted small">{t('augmenter.help', { mw: AUGMENTER_MW, base: fmt(AUGMENTER_BOOST * 100), fueled: fmt((AUGMENTER_BOOST + AUGMENTER_FUEL_BOOST) * 100), rate: AUGMENTER_FUEL_RATE })}</p>
      <h3>{t('augmenter.fuel')}</h3>
      {node?.inputs.length ? (
        <p className={'small ' + (fuel >= 0.999 ? 'ok' : 'warn')}>
          {t('augmenter.byBelt', { got: fmt(node.inputs[0].got), need: AUGMENTER_FUEL_RATE })}
        </p>
      ) : (
        <label className="switch">
          <input type="checkbox" checked={!!e.fueled} onChange={(ev) => useEditor.getState().updateEntity(e.uid, { fueled: ev.target.checked || undefined })} />
          {t('augmenter.fueled', { rate: AUGMENTER_FUEL_RATE })}
        </label>
      )}
      <div className="flowline">
        <span>{t('augmenter.boost')}</span>
        <b>+{fmt(boost * 100)} %</b>
      </div>
      {g ? (
        <p className="muted small">
          {t('augmenter.grid', { id: g.id, base: fmt(g.base + (g.world ? power.worldSpare : 0)), total: fmt(g.generation), pct: fmt(g.boost * 100) })}
        </p>
      ) : (
        <p className="muted small">{power.infinite ? t('augmenter.infinite', { pct: fmt(power.planBoost * 100) }) : t('augmenter.noGrid')}</p>
      )}
    </section>
  )
}

/** Consumo de una máquina de potencia variable: mínimo y máximo del ciclo, y el promedio que se cuenta en la red. */
function VariablePowerNote({ e, b, range }: { e: PlacedEntity; b: Building; range: [number, number] }) {
  const { t } = useTranslation()
  const k = consumptionMW(e, b) / ((range[0] + range[1]) / 2 || 1)
  return <p className="muted small">{t('machine.variablePower', { min: fmt(range[0] * k), max: fmt(range[1] * k), avg: fmt(consumptionMW(e, b)) })}</p>
}

function ExtractorConfig({ e, b }: { e: PlacedEntity; b: Building }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const resources = extractorResources(b)
  const resource = e.resource ?? resources[0]
  const purityApplies = !/WaterPump/.test(b.id)
  const map = useEditor((s) => s.map)
  const spot = map ? spotUnder(e, b, map) : null
  const fromSpot = spot ? spotPatch(spot) : null
  const differs = !!fromSpot && ((!!fromSpot.resource && fromSpot.resource !== resource) || (!!fromSpot.purity && fromSpot.purity !== (e.purity ?? 'normal')))
  return (
    <>
      <h3>{t('machine.node')}</h3>
      {spot && (
        <p className={'small ' + (differs ? 'warn' : 'ok')}>
          {t('side.onNode', { item: itemName(spot.resource), purity: spot.purity ? t(`purity.${spot.purity}`).toLowerCase() : '-' })}{' '}
          {differs && (
            <button className="link" onClick={() => update(e.uid, fromSpot!)}>
              {t('side.useNode')}
            </button>
          )}
        </p>
      )}
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
              {t(`purity.${p}`)}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        <Trans
          i18nKey="machine.produces"
          values={{ n: fmt(extractionRate(e, b)), unit: game.items[resource]?.form === 'solid' ? '/min' : 'm³/min' }}
          components={{ b: <b /> }}
        />
      </p>
    </>
  )
}

function GeneratorConfig({ e, b }: { e: PlacedEntity; b: Building & { fuels?: { fuel: string }[] } }) {
  const { t } = useTranslation()
  const update = useEditor((s) => s.updateEntity)
  const fuels = (b as { fuels?: { fuel: string }[] }).fuels?.map((f) => f.fuel).filter((f) => game.items[f]) ?? []
  if (!fuels.length) return <p className="muted">{t('machine.generates', { mw: b.powerGenMW })}</p>
  const fuel = e.resource ?? ''
  const energy = fuel ? game.items[fuel]?.energyMJ ?? 0 : 0
  return (
    <>
      <h3>{t('machine.fuel')}</h3>
      <select value={fuel} onChange={(ev) => update(e.uid, { resource: ev.target.value || undefined })}>
        <option value="">{t('machine.choose')}</option>
        {fuels.map((f) => (
          <option key={f} value={f}>
            {itemName(f)}
          </option>
        ))}
      </select>
      {energy > 0 && (
        <p className="muted">
          {t('machine.fuelUse', { n: fmt(((b.powerGenMW * 60) / energy) * (e.clock ?? 1)), mw: fmt(b.powerGenMW * (e.clock ?? 1)) })}
        </p>
      )}
    </>
  )
}

function RecipePicker({ buildingId, current, onPick }: { buildingId: string; current?: string; onPick: (id: string) => void }) {
  const { t } = useTranslation()
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
      <input className="search" placeholder={t('machine.searchRecipe')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {avail.enabled && (
        <p className="hidden-note">
          {hidden > 0 && t('machine.hiddenRecipes', { n: hidden })}
          <label>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> {t('machine.showAll')}
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
        {r.alternate && <span className="tag">{i18n.t('machine.alternate')}</span>}
      </div>
      <div className="recipe-io">
        <div>
          {r.ingredients.map((i) => (
            <div key={i.item}>
              <b>{fmt(i.amount * perMin)}</b> <ItemLabel item={i.item} name={itemName(i.item)} size={14} />
            </div>
          ))}
        </div>
        <span className="arrow">→</span>
        <div>
          {r.products.map((p) => (
            <div key={p.item}>
              <b>{fmt(p.amount * perMin)}</b> <ItemLabel item={p.item} name={itemName(p.item)} size={14} />
            </div>
          ))}
        </div>
      </div>
      <div className="muted small">{i18n.t('machine.perMinute', { s: fmt(r.duration) })}</div>
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
