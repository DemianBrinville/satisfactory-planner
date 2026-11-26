import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import AuthModal, { RecoveryModal } from './components/AuthModal'
import CommunityModal from './components/CommunityModal'
import Palette from './components/Palette'
import PlannerCanvas from './components/PlannerCanvas'
import ProgressModal from './components/ProgressModal'
import SidePanel from './components/SidePanel'
import Topbar from './components/Topbar'

const LAYOUT_KEY = 'satisfactory-planner:layout-v2'

function App() {
  const [progressOpen, setProgressOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  // paneles laterales plegables, cada uno por separado (se recuerda entre visitas)
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>(() => {
    try {
      return { left: true, right: true, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
    } catch {
      return { left: true, right: true }
    }
  })
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(panels)), [panels])

  return (
    <div className={'app' + (panels.left ? '' : ' no-left') + (panels.right ? '' : ' no-right')}>
      <Topbar
        onProgress={() => setProgressOpen(true)}
        onCommunity={() => setCommunityOpen(true)}
      />
      {panels.left && <Palette />}
      <div className="canvas-cell">
        <PlannerCanvas />
        {/* pestañas en el borde de cada panel para plegarlo o desplegarlo */}
        <button
          className="edge-handle left"
          onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}
          title={panels.left ? 'Ocultar la paleta' : 'Mostrar la paleta'}
        >
          {panels.left ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
        <button
          className="edge-handle right"
          onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}
          title={panels.right ? 'Ocultar el panel de detalles' : 'Mostrar el panel de detalles'}
        >
          {panels.right ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      {panels.right && <SidePanel />}
      {progressOpen && <ProgressModal onClose={() => setProgressOpen(false)} />}
      {communityOpen && <CommunityModal onClose={() => setCommunityOpen(false)} />}
      <AuthModal />
      <RecoveryModal />
    </div>
  )
}

export default App
