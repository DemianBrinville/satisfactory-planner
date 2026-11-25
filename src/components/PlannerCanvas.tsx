import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { buildingsById, type Building } from '../data/gameData'
import {
  FOUNDATION,
  normRect,
  portsOf,
  rectContainsPoint,
  rectsOverlap,
  snapAnchor,
  snapModeOf,
  toWorld,
  worldRect,
  type Rect as WRect,
  type Rotation,
  type Vec,
} from '../editor/geometry'
import { entityRect, useEditor, type PlacedEntity } from '../editor/store'

const COLORS: Record<string, string> = {
  machine: '#c9822b',
  miner: '#8d6e4c',
  extractor: '#3f7f9a',
  generator: '#6b5fa8',
  splitter: '#a0a0a0',
  pipeJunction: '#5b8fb0',
  pump: '#5b8fb0',
  valve: '#5b8fb0',
  foundation: '#3a3631',
  wall: '#6a6259',
  structure: '#7a7f86',
  lift: '#9a8f50',
}
const PORT_IN = '#f08a24'
const PORT_OUT = '#4fe0c0'

type Interaction =
  | { type: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { type: 'move'; start: Vec; step: number }
  | { type: 'box'; start: Vec }
  | null

export default function PlannerCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [mouse, setMouse] = useState<Vec>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<Vec>({ x: 0, y: 0 })
  const [box, setBox] = useState<WRect | null>(null)
  const inter = useRef<Interaction>(null)
  const spaceDown = useRef(false)

  const s = useEditor()
  const { view, entities, selection, floor, placingId, placingRot } = s

  // tamaño del lienzo
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // teclado
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const st = useEditor.getState()
      if (e.code === 'Space') spaceDown.current = true
      if (e.key === 'r' || e.key === 'R') {
        if (st.placingId) st.rotatePlacing(e.shiftKey ? -1 : 1)
        else st.rotateSelection()
      }
      if (e.key === 'Escape') {
        if (st.placingId) st.cancelPlacing()
        else st.select([])
      }
      if (e.key === 'Delete' || e.key === 'Backspace') st.deleteSelection()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const toWorldPt = (px: number, py: number): Vec => ({
    x: (px - view.offsetX) / view.scale,
    y: (py - view.offsetY) / view.scale,
  })

  const visible = useMemo(() => entities.filter((e) => e.floor === floor), [entities, floor])
  const below = useMemo(() => entities.filter((e) => e.floor === floor - 1), [entities, floor])

  const hitTest = (p: Vec): PlacedEntity | null => {
    // primero lo que está encima (máquinas), luego cimientos
    const ordered = [...visible].sort((a, b) => layerRank(b) - layerRank(a))
    return ordered.find((e) => {
      const r = entityRect(e)
      return r ? rectContainsPoint(r, p) : false
    }) ?? null
  }

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const st = useEditor.getState()
    if (st.placingId && e.evt.shiftKey) {
      st.rotatePlacing(e.evt.deltaY > 0 ? 1 : -1)
      return
    }
    const pos = e.target.getStage()!.getPointerPosition()!
    const factor = e.evt.deltaY > 0 ? 1 / 1.15 : 1.15
    const scale = Math.min(80, Math.max(1, view.scale * factor))
    const w = toWorldPt(pos.x, pos.y)
    st.setView({ scale, offsetX: pos.x - w.x * scale, offsetY: pos.y - w.y * scale })
  }

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()!.getPointerPosition()!
    const p = toWorldPt(pos.x, pos.y)
    const st = useEditor.getState()
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown.current)) {
      inter.current = { type: 'pan', startX: pos.x, startY: pos.y, ox: view.offsetX, oy: view.offsetY }
      return
    }
    if (e.evt.button === 2) {
      if (st.placingId) st.cancelPlacing()
      else st.select([])
      return
    }
    if (e.evt.button !== 0) return
    if (st.placingId) {
      const b = buildingsById.get(st.placingId)!
      st.place(snapAnchor(b, p, st.placingRot))
      return
    }
    const hit = hitTest(p)
    if (hit) {
      if (!st.selection.includes(hit.uid)) st.select([hit.uid], e.evt.shiftKey)
      const sel = st.selection.includes(hit.uid) ? st.selection : e.evt.shiftKey ? [...st.selection, hit.uid] : [hit.uid]
      const step = sel.some((u) => {
        const b = buildingsById.get(entities.find((x) => x.uid === u)?.buildingId ?? '')
        return b && snapModeOf(b) !== 'meter'
      })
        ? FOUNDATION
        : 1
      inter.current = { type: 'move', start: p, step }
    } else {
      if (!e.evt.shiftKey) st.select([])
      inter.current = { type: 'box', start: p }
      setBox(normRect(p, p))
    }
  }

  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()!.getPointerPosition()!
    const p = toWorldPt(pos.x, pos.y)
    setMouse(p)
    const it = inter.current
    if (!it) return
    if (it.type === 'pan') {
      useEditor.getState().setView({ offsetX: it.ox + pos.x - it.startX, offsetY: it.oy + pos.y - it.startY })
    } else if (it.type === 'move') {
      setDrag({
        x: Math.round((p.x - it.start.x) / it.step) * it.step,
        y: Math.round((p.y - it.start.y) / it.step) * it.step,
      })
    } else if (it.type === 'box') {
      setBox(normRect(it.start, p))
    }
  }

  const onUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const it = inter.current
    inter.current = null
    const st = useEditor.getState()
    if (it?.type === 'move') {
      if (drag.x || drag.y) {
        const sel = st.selection
        const ok = sel.every((u) => {
          const en = entities.find((x) => x.uid === u)
          return en && st.canPlace(en.buildingId, { x: en.x + drag.x, y: en.y + drag.y }, en.rot, sel)
        })
        if (ok) st.moveSelection(drag.x, drag.y)
      }
      setDrag({ x: 0, y: 0 })
    } else if (it?.type === 'box' && box) {
      const tiny = box.x1 - box.x0 < 0.3 && box.y1 - box.y0 < 0.3
      if (!tiny) {
        const hits = visible.filter((en) => {
          const r = entityRect(en)
          return r ? rectsOverlap(r, box, 0) : false
        })
        st.select(hits.map((h) => h.uid), e.evt.shiftKey)
      }
      setBox(null)
    }
  }

  // ---- fantasma de colocación ----
  const ghost = useMemo(() => {
    if (!placingId) return null
    const b = buildingsById.get(placingId)
    if (!b) return null
    const anchor = snapAnchor(b, mouse, placingRot)
    return { b, anchor, ok: s.canPlace(placingId, anchor, placingRot) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingId, placingRot, mouse, entities, floor])

  const sorted = useMemo(() => [...visible].sort((a, b) => layerRank(a) - layerRank(b)), [visible])
  const showLabels = view.scale >= 6

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: placingId ? 'crosshair' : 'default' }}
    >
      <Stage width={size.w} height={size.h} onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
        <Layer x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale} listening={false}>
          <Grid view={view} w={size.w} h={size.h} />
          {below.map((e) => (
            <EntityShape key={e.uid} e={e} scale={view.scale} faded showLabels={false} />
          ))}
          {sorted.map((e) => {
            const sel = selection.includes(e.uid)
            const moved = sel && (drag.x || drag.y) ? { ...e, x: e.x + drag.x, y: e.y + drag.y } : e
            return <EntityShape key={e.uid} e={moved} scale={view.scale} selected={sel} showLabels={showLabels} />
          })}
          {ghost && (
            <EntityShape
              e={{ uid: 'ghost', buildingId: ghost.b.id, x: ghost.anchor.x, y: ghost.anchor.y, rot: placingRot, floor }}
              scale={view.scale}
              ghost={ghost.ok ? 'ok' : 'bad'}
              showLabels={showLabels}
            />
          )}
          {box && (
            <Rect
              x={box.x0}
              y={box.y0}
              width={box.x1 - box.x0}
              height={box.y1 - box.y0}
              fill="rgba(79,224,192,0.08)"
              stroke="#4fe0c0"
              strokeWidth={1 / view.scale}
              dash={[4 / view.scale, 3 / view.scale]}
            />
          )}
        </Layer>
      </Stage>
      <div className="coords">
        x {mouse.x.toFixed(1)} m · y {mouse.y.toFixed(1)} m · cimiento ({Math.floor(mouse.x / FOUNDATION)},{' '}
        {Math.floor(mouse.y / FOUNDATION)})
      </div>
    </div>
  )
}

const layerRank = (e: PlacedEntity) => (buildingsById.get(e.buildingId)?.kind === 'foundation' ? 0 : 1)

function Grid({ view, w, h }: { view: { scale: number; offsetX: number; offsetY: number }; w: number; h: number }) {
  return (
    <Shape
      sceneFunc={(ctx) => {
        const x0 = -view.offsetX / view.scale
        const y0 = -view.offsetY / view.scale
        const x1 = x0 + w / view.scale
        const y1 = y0 + h / view.scale
        const c = ctx._context
        c.fillStyle = '#17181a'
        c.fillRect(x0, y0, x1 - x0, y1 - y0)
        const lines = (step: number, color: string, width: number) => {
          c.beginPath()
          c.strokeStyle = color
          c.lineWidth = width / view.scale
          for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
            c.moveTo(x, y0)
            c.lineTo(x, y1)
          }
          for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
            c.moveTo(x0, y)
            c.lineTo(x1, y)
          }
          c.stroke()
        }
        if (view.scale >= 5) lines(1, '#222427', 1)
        lines(FOUNDATION, view.scale >= 3 ? '#34373c' : '#2a2c30', 1.5)
        c.beginPath()
        c.strokeStyle = '#5a3d1e'
        c.lineWidth = 2 / view.scale
        c.moveTo(0, y0)
        c.lineTo(0, y1)
        c.moveTo(x0, 0)
        c.lineTo(x1, 0)
        c.stroke()
      }}
    />
  )
}

function EntityShape({
  e,
  scale,
  selected,
  faded,
  ghost,
  showLabels,
}: {
  e: PlacedEntity
  scale: number
  selected?: boolean
  faded?: boolean
  ghost?: 'ok' | 'bad'
  showLabels: boolean
}) {
  const b = buildingsById.get(e.buildingId)
  if (!b) return null
  const r = worldRect(b, e, e.rot)
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const base = COLORS[b.kind] ?? COLORS.structure
  const fill = ghost ? (ghost === 'ok' ? 'rgba(79,170,224,0.45)' : 'rgba(224,80,70,0.5)') : base
  const isFoundation = b.kind === 'foundation'
  return (
    <Group opacity={faded ? 0.18 : 1}>
      <Rect
        x={r.x0}
        y={r.y0}
        width={w}
        height={h}
        fill={fill}
        opacity={isFoundation && !ghost ? 0.9 : 1}
        stroke={selected ? '#4fe0c0' : isFoundation ? '#4a453e' : '#111'}
        strokeWidth={(selected ? 2.5 : 1) / scale}
        cornerRadius={isFoundation ? 0 : 0.3}
      />
      {!isFoundation && <FrontMark b={b} e={e} scale={scale} />}
      {!isFoundation && <Ports b={b} e={e} scale={scale} />}
      {showLabels && !isFoundation && w * scale > 40 && (
        <Text
          x={r.x0}
          y={r.y0 + h / 2 - Math.min(1.1, w / 7) / 2}
          width={w}
          align="center"
          text={b.name}
          fontSize={Math.min(1.1, w / 7)}
          fill="#fff"
          fontStyle="bold"
          wrap="none"
          ellipsis
        />
      )}
    </Group>
  )
}

/** Línea en el borde frontal (lado de salida) para ver la orientación. */
function FrontMark({ b, e, scale }: { b: Building; e: PlacedEntity; scale: number }) {
  const f = b.footprint
  if (!f || b.kind === 'wall') return null
  const p = toWorld(b, e, e.rot as Rotation, { x: f.minX + 0.3, y: f.minY + 0.3 })
  const q = toWorld(b, e, e.rot as Rotation, { x: f.maxX - 0.3, y: f.minY + 0.3 })
  return <Line points={[p.x, p.y, q.x, q.y]} stroke="rgba(255,255,255,0.35)" strokeWidth={2 / scale} />
}

function Ports({ b, e, scale }: { b: Building; e: PlacedEntity; scale: number }) {
  const ports = portsOf(b)
  if (!ports.length) return null
  return (
    <>
      {ports.map((p, i) => {
        const at = toWorld(b, e, e.rot as Rotation, p.pos)
        const outer = toWorld(b, e, e.rot as Rotation, {
          x: p.pos.x + p.normal.x * 0.9,
          y: p.pos.y + p.normal.y * 0.9,
        })
        const color = p.dir === 'in' ? PORT_IN : PORT_OUT
        if (p.kind === 'pipe') {
          return (
            <Shape
              key={i}
              sceneFunc={(ctx, shape) => {
                ctx.beginPath()
                ctx.arc(at.x, at.y, 0.7, 0, Math.PI * 2)
                ctx.fillStrokeShape(shape)
              }}
              fill="#16202a"
              stroke={color}
              strokeWidth={2 / scale}
            />
          )
        }
        // triángulo que apunta en el sentido del flujo
        const back = p.dir === 'out' ? at : outer
        const point = p.dir === 'out' ? outer : at
        const nx = -(outer.y - at.y) * 0.6
        const ny = (outer.x - at.x) * 0.6
        return (
          <Line
            key={i}
            points={[back.x + nx, back.y + ny, point.x, point.y, back.x - nx, back.y - ny]}
            closed
            fill={color}
            stroke="#111"
            strokeWidth={0.5 / scale}
          />
        )
      })}
    </>
  )
}
