import { Check, Download, Pencil, Trash2, Upload, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blockSize, useBlocks, type Block } from '../cloud/blocks'
import { useCloud } from '../cloud/cloud'
import { buildingsById } from '../data/gameData'
import { locale } from '../i18n/format'
import { entityRect, layerOf, useEditor, type Clipboard } from '../editor/store'
import Modal from './Modal'

const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 })

/** Dibujo chico del bloque visto desde arriba: cimientos, estructuras, cintas, tuberías y vías. */
export function BlockPreview({ data, size = 72 }: { data: Clipboard; size?: number }) {
  const shapes = useMemo(() => {
    const rects = data.entities.flatMap((e) => {
      const r = entityRect(e)
      return r ? [{ r, base: layerOf(e.buildingId) === 'base' }] : []
    })
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    const add = (x: number, y: number) => {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
    rects.forEach(({ r }) => (add(r.x0, r.y0), add(r.x1, r.y1)))
    data.conveyors.forEach((c) => c.points.forEach((p) => add(p.x, p.y)))
    data.rails?.forEach((c) => c.points.forEach((p) => add(p.x, p.y)))
    if (!isFinite(x0)) return null
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04 + 0.5
    return { rects, box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`, stroke: Math.max(x1 - x0, y1 - y0) / 90 }
  }, [data])
  if (!shapes) return <div className="block-preview" style={{ width: size, height: size }} />
  return (
    <svg className="block-preview" width={size} height={size} viewBox={shapes.box} preserveAspectRatio="xMidYMid meet">
      {shapes.rects
        .filter((s) => s.base)
        .map(({ r }, i) => (
          <rect key={'b' + i} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="#45474d" stroke="#5a5c63" strokeWidth={shapes.stroke} />
        ))}
      {data.rails?.map((r, i) => (
        <polyline key={'r' + i} points={r.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#b9ad97" strokeWidth={shapes.stroke * 3} />
      ))}
      {data.conveyors.map((c, i) => (
        <polyline
          key={'c' + i}
          points={c.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={buildingsById.get(c.buildingId)?.kind === 'pipe' ? '#4aa3df' : '#d8d8d8'}
          strokeWidth={shapes.stroke * 2}
        />
      ))}
      {shapes.rects
        .filter((s) => !s.base)
        .map(({ r }, i) => (
          <rect key={'e' + i} x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="#e59345" fillOpacity={0.85} stroke="#f4b67c" strokeWidth={shapes.stroke} />
        ))}
    </svg>
  )
}

/** Resumen de un bloque: medidas, qué tiene y en qué Diseñador de planos del juego entraría. */
function useBlockInfo(data: Clipboard) {
  const { t } = useTranslation()
  return useMemo(() => {
    const s = blockSize(data)
    const parts = [t('blocks.structures', { count: data.entities.length })]
    if (data.conveyors.length) parts.push(t('blocks.lines', { count: data.conveyors.length }))
    if (data.wires?.length) parts.push(t('blocks.wires', { count: data.wires.length }))
    if (data.rails?.length) parts.push(t('blocks.rails', { count: data.rails.length }))
    return {
      dims: t('blocks.dims', { w: fmt(s.w), h: fmt(s.h) }),
      parts: parts.join(' · '),
      designer: s.designer ? t('blocks.designer', { n: s.designer }) : t('blocks.tooBig'),
      fits: s.designer !== null,
    }
  }, [data, t])
}

/** Pestaña "Bloques" de la paleta: lista de bloques guardados para colocar en el plano. */
export function BlocksPanel() {
  const { t } = useTranslation()
  const { blocks, importFile, cloud } = useBlocks()
  const user = useCloud((s) => s.user)
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const list = q ? blocks.filter((b) => b.name.toLowerCase().includes(q) || b.description?.toLowerCase().includes(q)) : blocks

  return (
    <div className="blocks">
      <p className="muted small">{t('blocks.help')}</p>
      <p className="muted small">{user && cloud ? t('blocks.synced') : user ? t('blocks.localOnly') : t('blocks.guest')}</p>
      <div className="blocks-tools">
        {blocks.length > 3 && <input className="search" placeholder={t('blocks.search')} value={query} onChange={(e) => setQuery(e.target.value)} />}
        <button className="btn" onClick={() => fileRef.current?.click()} title={t('blocks.importTitle')}>
          <Upload size={14} /> {t('blocks.import')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            let ok = 0
            for (const f of files) if (await importFile(f)) ok++
            setMsg(ok ? t('blocks.imported', { count: ok }) : t('blocks.importFailed'))
          }}
        />
      </div>
      {msg && <p className="muted small">{msg}</p>}
      {blocks.length === 0 ? (
        <p className="blocks-empty">{t('blocks.empty')}</p>
      ) : (
        <ul className="block-list">
          {list.map((b) => (
            <BlockCard key={b.id} b={b} />
          ))}
        </ul>
      )}
    </div>
  )
}

function BlockCard({ b }: { b: Block }) {
  const { t } = useTranslation()
  const { update, remove, exportFile } = useBlocks()
  const info = useBlockInfo(b.data)
  const active = useEditor((s) => s.tool === 'paste' && s.clipboard === pasting.get(b.id))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(b.name)
  const [desc, setDesc] = useState(b.description ?? '')
  const [confirm, setConfirm] = useState(false)

  if (editing)
    return (
      <li className="block-card editing">
        <input className="search" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <textarea className="search" maxLength={500} rows={2} value={desc} placeholder={t('blocks.descPlaceholder')} onChange={(e) => setDesc(e.target.value)} />
        <div className="block-actions">
          <button
            className="icon-btn sm"
            title={t('blocks.saveChanges')}
            onClick={() => {
              update(b.id, { name, description: desc })
              setEditing(false)
            }}
          >
            <Check size={14} />
          </button>
          <button className="icon-btn sm" title={t('account.cancel')} onClick={() => setEditing(false)}>
            <X size={14} />
          </button>
        </div>
      </li>
    )

  return (
    <li className={'block-card' + (active ? ' active' : '')}>
      <button className="block-main" onClick={() => placeBlock(b)} title={t('blocks.placeTitle')}>
        <BlockPreview data={b.data} />
        <span className="block-text">
          <span className="name">{b.name}</span>
          {b.description && <span className="muted small desc">{b.description}</span>}
          <span className="muted small">{info.dims}</span>
          <span className="muted small">{info.parts}</span>
          <span className={'small ' + (info.fits ? 'muted' : 'warn')}>{info.designer}</span>
        </span>
      </button>
      <div className="block-actions">
        {confirm ? (
          <>
            <span className="small">{t('blocks.confirmDelete')}</span>
            <button className="icon-btn sm danger" title={t('blocks.delete')} onClick={() => remove(b.id)}>
              <Check size={14} />
            </button>
            <button className="icon-btn sm" title={t('account.cancel')} onClick={() => setConfirm(false)}>
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-btn sm"
              title={t('blocks.edit')}
              onClick={() => {
                setName(b.name)
                setDesc(b.description ?? '')
                setEditing(true)
              }}
            >
              <Pencil size={14} />
            </button>
            <button className="icon-btn sm" title={t('blocks.export')} onClick={() => exportFile(b)}>
              <Download size={14} />
            </button>
            <button className="icon-btn sm" title={t('blocks.delete')} onClick={() => setConfirm(true)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  )
}

/** Grupo que se está colocando de cada bloque (para marcar la tarjeta activa). */
const pasting = new Map<string, Clipboard>()
function placeBlock(b: Block) {
  const st = useEditor.getState()
  st.pasteGroup(b.data)
  pasting.clear()
  const cb = useEditor.getState().clipboard
  if (cb) pasting.set(b.id, cb)
}

/** Ventana para ponerle nombre a lo seleccionado y guardarlo como bloque. */
export function SaveBlockModal() {
  const { t } = useTranslation()
  const { saving, setSaving, save } = useBlocks()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  if (!saving) return null
  const close = () => {
    setSaving(null)
    setName('')
    setDesc('')
  }
  return (
    <SaveBlockForm
      data={saving}
      name={name}
      desc={desc}
      setName={setName}
      setDesc={setDesc}
      onClose={close}
      onSave={async () => {
        await save(name || t('blocks.untitled'), desc, saving)
        close()
      }}
    />
  )
}

function SaveBlockForm({
  data,
  name,
  desc,
  setName,
  setDesc,
  onClose,
  onSave,
}: {
  data: Clipboard
  name: string
  desc: string
  setName: (s: string) => void
  setDesc: (s: string) => void
  onClose: () => void
  onSave: () => void
}) {
  const { t } = useTranslation()
  const info = useBlockInfo(data)
  return (
    <Modal title={t('blocks.saveTitle')} onClose={onClose} width={460}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          onSave()
        }}
      >
        <div className="block-summary">
          <BlockPreview data={data} size={96} />
          <div>
            <div>{info.dims}</div>
            <div className="muted small">{info.parts}</div>
            <div className={'small ' + (info.fits ? 'muted' : 'warn')}>{info.designer}</div>
          </div>
        </div>
        <label className="field">
          <span>{t('blocks.name')}</span>
          <input autoFocus maxLength={120} value={name} placeholder={t('blocks.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('blocks.description')}</span>
          <textarea maxLength={500} rows={3} value={desc} placeholder={t('blocks.descPlaceholder')} onChange={(e) => setDesc(e.target.value)} />
        </label>
        <p className="muted small">{t('blocks.saveHelp')}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('account.cancel')}
          </button>
          <button type="submit" className="btn primary">
            {t('blocks.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
