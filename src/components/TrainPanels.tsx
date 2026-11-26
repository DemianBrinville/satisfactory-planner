import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { itemName } from '../data/gameData'
import { locale } from '../i18n/format'
import type { FlowResult } from '../editor/flow'
import { NONE, useEditor, type PlacedEntity } from '../editor/store'
import { routeThroughput, type Route } from '../editor/transport'
import {
  CAR_LENGTH,
  DOCK_TIME,
  LOCO_MW_MAX,
  LOCO_MW_MIN,
  TRAIN_SPEED,
  buildRailNet,
  cycleTime,
  expandTimetable,
  isFreightPlatform,
  isTrainStation,
  legsOf,
  stationGroup,
  stationName,
  timetableFlows,
} from '../editor/trains'

const fmt = (n: number, d = 1) => n.toLocaleString(locale(), { maximumFractionDigits: d })

/** Nombre visible de una estación de tren. */
export function useStationName() {
  const { t } = useTranslation()
  return (e: PlacedEntity, entities: PlacedEntity[]) => stationName(e, entities, (n) => t('train.stationN', { n }))
}

/** Tren con horario: paradas en orden, trenes, locomotoras y vagones, vuelta por las vías y lo que mueve. */
export function TrainPanel({ r, flows }: { r: Route; flows: FlowResult }) {
  const { t } = useTranslation()
  const { updateRoute } = useEditor()
  const entities = useEditor((s) => s.entities)
  const rails = useEditor((s) => s.rails) ?? NONE
  const nameOf = useStationName()
  const net = useMemo(() => buildRailNet(entities, rails), [entities, rails])
  const stops = r.stops ?? []
  const legs = legsOf(r, net)
  const cycle = cycleTime(r, net, entities)
  const totalDist = legs.reduce((a, l) => a + (l.dist ?? 0), 0)
  const virtual = useMemo(() => expandTimetable(r, net, entities), [r, net, entities])
  const moved = timetableFlows(flows.edges, (v, item) => routeThroughput(v, item, entities), virtual)
  const stations = entities.filter((e) => isTrainStation(e.buildingId))
  const [adding, setAdding] = useState('')
  const wagons = Math.max(1, r.count ?? 1)
  const locos = Math.max(1, r.locos ?? 1)
  const trains = Math.max(1, r.trains ?? 1)
  const byUid = new Map(entities.map((e) => [e.uid, e]))

  const setStops = (next: string[]) => updateRoute(r.uid, { stops: next, from: next[0], to: next[1] })
  const move = (i: number, d: number) => {
    const next = [...stops]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setStops(next)
  }

  const num = (label: string, value: number, key: 'count' | 'locos' | 'trains', title?: string) => (
    <div className="flowline">
      <span title={title}>{label}</span>
      <input
        className="small-input"
        type="number"
        min={1}
        value={value}
        onChange={(ev) => updateRoute(r.uid, { [key]: Math.max(1, Math.round(Number(ev.target.value) || 1)) })}
      />
    </div>
  )

  return (
    <section className="machine">
      <h2>{t('train.title')}</h2>
      {num(t('train.trains'), trains, 'trains', t('train.trainsHint'))}
      {num(t('train.locos'), locos, 'locos')}
      {num(t('route.wagons'), wagons, 'count')}
      <div className="flowline">
        <span>{t('route.speed')}</span>
        <input
          className="small-input"
          type="number"
          min={5}
          max={200}
          placeholder={String(TRAIN_SPEED)}
          value={r.speed ?? ''}
          onChange={(ev) => updateRoute(r.uid, { speed: ev.target.value ? Number(ev.target.value) : undefined })}
        />
      </div>
      <p className="muted small">{t('train.length', { m: (locos + wagons) * CAR_LENGTH })}</p>

      <h3>{t('train.timetable')}</h3>
      <ol className="train-stops">
        {stops.map((uid, i) => {
          const e = byUid.get(uid)
          if (!e) return null
          const g = stationGroup(e, entities)
          const freight = g.platforms.filter((p) => isFreightPlatform(p.buildingId))
          const loads = freight.filter((p) => (p.platformMode ?? 'load') === 'load').length
          const leg = legs[i]
          return (
            <li key={uid + i}>
              <div className="stop-row">
                <button className="link" onClick={() => useEditor.getState().select([uid])} title={t('train.selectStation')}>
                  {nameOf(e, entities)}
                </button>
                <span className="stop-actions">
                  <button className="icon-btn sm" disabled={i === 0} onClick={() => move(i, -1)} title={t('train.up')}>
                    <ArrowUp size={13} />
                  </button>
                  <button className="icon-btn sm" disabled={i === stops.length - 1} onClick={() => move(i, 1)} title={t('train.down')}>
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="icon-btn sm"
                    disabled={stops.length <= 2}
                    onClick={() => setStops(stops.filter((_, k) => k !== i))}
                    title={t('train.removeStop')}
                  >
                    <X size={13} />
                  </button>
                </span>
              </div>
              <div className="muted small">
                {g.platforms.length === 0
                  ? t('train.noPlatforms')
                  : t('train.platforms', { count: g.platforms.length, load: loads, unload: freight.length - loads })}
              </div>
              {g.platforms.length > 0 && g.platforms.length < wagons && (
                <div className="warn small">{t('train.fewPlatforms', { n: g.platforms.length + 1, wagons })}</div>
              )}
              <div className={'small ' + (leg.dist === null ? 'bad' : 'muted')}>
                ↓{' '}
                {leg.dist === null
                  ? t('train.noTrack', { to: byUid.get(leg.to) ? nameOf(byUid.get(leg.to)!, entities) : '' })
                  : t('train.leg', { m: fmt(leg.dist, 0), to: byUid.get(leg.to) ? nameOf(byUid.get(leg.to)!, entities) : '' })}
              </div>
            </li>
          )
        })}
      </ol>
      <div className="flowline">
        <select value={adding} onChange={(ev) => setAdding(ev.target.value)}>
          <option value="">{t('train.pickStation')}</option>
          {stations.map((e) => (
            <option key={e.uid} value={e.uid}>
              {nameOf(e, entities)}
            </option>
          ))}
        </select>
        <button
          disabled={!adding || adding === stops[stops.length - 1]}
          onClick={() => {
            setStops([...stops, adding])
            setAdding('')
          }}
        >
          {t('train.addStop')}
        </button>
      </div>
      <p className="muted small">{t('train.cycle', { m: fmt(totalDist, 0), s: fmt(cycle, 0), dock: DOCK_TIME, stops: stops.length })}</p>
      <p className="muted small">{t('train.platformHelp')}</p>

      <h3>{t('train.power')}</h3>
      <p className="muted small">
        {t('train.powerUse', { min: fmt(LOCO_MW_MIN * locos * trains), max: fmt(LOCO_MW_MAX * locos * trains), n: locos * trains })}
      </p>

      <h3>{t('route.capacity')}</h3>
      {moved.size === 0 ? (
        <p className="muted small">{virtual.length ? t('train.nothingYet') : t('train.noLoads')}</p>
      ) : (
        [...moved].map(([item, [f, cap]]) => (
          <div key={item} className="tt-item">
            <b>{itemName(item)}</b>
            <div className="muted">{t('route.carries', { f: f.toFixed(1), cap: cap.toFixed(1) })}</div>
          </div>
        ))
      )}
    </section>
  )
}

/** Estación de tren: nombre y plataformas enganchadas. */
export function StationPanel({ e }: { e: PlacedEntity }) {
  const { t } = useTranslation()
  const entities = useEditor((s) => s.entities)
  const nameOf = useStationName()
  const g = stationGroup(e, entities)
  const freight = g.platforms.filter((p) => isFreightPlatform(p.buildingId))
  return (
    <section>
      <h3>{t('train.stationName')}</h3>
      <input
        className="wide-input"
        value={e.name ?? ''}
        placeholder={nameOf({ ...e, name: undefined }, entities)}
        onChange={(ev) => useEditor.getState().updateEntity(e.uid, { name: ev.target.value || undefined })}
      />
      <p className="muted small">
        {g.platforms.length === 0 ? t('train.noPlatformsHelp') : t('train.platforms', { count: g.platforms.length, load: freight.filter((p) => (p.platformMode ?? 'load') === 'load').length, unload: freight.filter((p) => p.platformMode === 'unload').length })}
      </p>
    </section>
  )
}

/** Plataforma de carga: carga o descarga, y a qué vagón atiende. */
export function PlatformPanel({ e }: { e: PlacedEntity }) {
  const { t } = useTranslation()
  const entities = useEditor((s) => s.entities)
  const nameOf = useStationName()
  const owner = entities
    .filter((x) => isTrainStation(x.buildingId))
    .map((st) => ({ st, i: stationGroup(st, entities).platforms.findIndex((p) => p.uid === e.uid) }))
    .find((x) => x.i >= 0)
  const mode = e.platformMode ?? 'load'
  return (
    <section>
      <h3>{t('train.platformTitle')}</h3>
      {isFreightPlatform(e.buildingId) && (
        <div className="segmented small">
          {(['load', 'unload'] as const).map((m) => (
            <button key={m} className={mode === m ? 'active' : ''} onClick={() => useEditor.getState().updateEntity(e.uid, { platformMode: m })}>
              {t(m === 'load' ? 'train.load' : 'train.unload')}
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        {owner ? t('train.platformOf', { n: owner.i + 1, station: nameOf(owner.st, entities) }) : t('train.platformLoose')}
      </p>
    </section>
  )
}
