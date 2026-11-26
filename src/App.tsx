import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import AuthModal, { RecoveryModal } from './components/AuthModal'
import { SaveBlockModal } from './components/Blocks'
import CalculatorModal from './components/CalculatorModal'
import CommunityModal from './components/CommunityModal'
import IconZoom from './components/IconZoom'
import Palette from './components/Palette'
import PlannerCanvas from './components/PlannerCanvas'
import ProgressModal from './components/ProgressModal'
import SidePanel from './components/SidePanel'
import Topbar from './components/Topbar'

const LAYOUT_KEY = 'satisfactory-planner:layout-v2'
interface Panels {
  left: boolean
  right: boolean
  leftW: number
  rightW: number
}
const DEFAULT_PANELS: Panels = { left: true, right: true, leftW: 380, rightW: 320 }
const MIN_W = 240
const MAX_W = 680

function App() {
  const { t } = useTranslation()
  const [progressOpen, setProgressOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  // paneles laterales plegables, cada uno por separado (se recuerda entre visitas)
  // y con el ancho que se les dio arrastrando el borde
  const [panels, setPanels] = useState<Panels>(() => {
    try {
      return { ...DEFAULT_PANELS, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
    } catch {
      return DEFAULT_PANELS
    }
  })
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(panels)), [panels])

  /** Arrastrar el borde de un panel cambia su ancho (doble clic vuelve al ancho por defecto). */
  const startResize = (side: 'left' | 'right') => (e: ReactPointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = side === 'left' ? panels.leftW : panels.rightW
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, start + (side === 'left' ? dx : -dx))))
      setPanels((p) => (side === 'left' ? { ...p, leftW: w } : { ...p, rightW: w }))
    }
    const up = () => {
      document.body.classList.remove('resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={'app' + (panels.left ? '' : ' no-left') + (panels.right ? '' : ' no-right')}
      style={{ gridTemplateColumns: `${panels.left ? panels.leftW : 0}px 1fr ${panels.right ? panels.rightW : 0}px` }}
    >
      <Topbar
        onCalculator={() => setCalcOpen(true)}
        onProgress={() => setProgressOpen(true)}
        onCommunity={() => setCommunityOpen(true)}
      />
      {panels.left && <Palette />}
      <div className="canvas-cell">
        <PlannerCanvas />
        {panels.left && (
          <div
            className="panel-resizer left"
            onPointerDown={startResize('left')}
            onDoubleClick={() => setPanels((p) => ({ ...p, leftW: DEFAULT_PANELS.leftW }))}
            title={t('panels.resize')}
          />
        )}
        {panels.right && (
          <div
            className="panel-resizer right"
            onPointerDown={startResize('right')}
            onDoubleClick={() => setPanels((p) => ({ ...p, rightW: DEFAULT_PANELS.rightW }))}
            title={t('panels.resize')}
          />
        )}
        {/* pestañas en el borde de cada panel para plegarlo o desplegarlo */}
        <button
          className="edge-handle left"
          onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}
          title={panels.left ? t('panels.hidePalette') : t('panels.showPalette')}
        >
          {panels.left ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
        <button
          className="edge-handle right"
          onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}
          title={panels.right ? t('panels.hideDetails') : t('panels.showDetails')}
        >
          {panels.right ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      {panels.right && <SidePanel />}
      {progressOpen && <ProgressModal onClose={() => setProgressOpen(false)} />}
      {communityOpen && <CommunityModal onClose={() => setCommunityOpen(false)} />}
      {calcOpen && <CalculatorModal onClose={() => setCalcOpen(false)} />}
      <AuthModal />
      <RecoveryModal />
      <SaveBlockModal />
      <IconZoom />
    </div>
  )
}

export default App
