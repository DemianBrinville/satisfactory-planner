import { Boxes, Eye, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCloud, type PublicPlan } from '../cloud/cloud'
import Modal from './Modal'

/** Planos que comparten los jugadores: se abren en modo vista y se puede guardar una copia. */
export default function CommunityModal({ onClose }: { onClose: () => void }) {
  const { listPublic, viewPublic, user, profile } = useCloud()
  const [query, setQuery] = useState('')
  const [plans, setPlans] = useState<PublicPlan[] | null>(null)

  useEffect(() => {
    const t = setTimeout(() => listPublic(query).then(setPlans), 250)
    return () => clearTimeout(t)
  }, [query, listPublic])

  return (
    <Modal title="Comunidad" onClose={onClose} width={860}>
      <div className="input-icon">
        <Search size={16} className="lead" />
        <input placeholder="Buscar planos por nombre…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      {!user && <p className="muted small">Puedes ver los planos sin cuenta. Para compartir los tuyos, inicia sesión.</p>}
      {plans === null && <p className="muted">Cargando…</p>}
      {plans?.length === 0 && (
        <p className="muted">
          Todavía no hay planos compartidos{query ? ' con ese nombre' : ''}. Comparte uno desde <b>Mis planos</b>.
        </p>
      )}
      <div className="cards">
        {plans?.map((p) => {
          const mine = p.user_id === profile?.id
          const author = p.author?.display_name || (p.author?.username ? '@' + p.author.username : 'Pionero anónimo')
          return (
            <article key={p.id} className="card">
              <h3>{p.name}</h3>
              <p className="card-author">
                {author}
                {mine && <span className="tag">tuyo</span>}
              </p>
              {p.description && <p className="card-desc">{p.description}</p>}
              <div className="card-foot">
                <span className="muted small">
                  <Boxes size={14} /> {p.size} estructuras · {new Date(p.updated_at).toLocaleDateString('es')}
                </span>
                <button
                  className="btn sm primary"
                  onClick={async () => {
                    await viewPublic(p)
                    onClose()
                  }}
                >
                  <Eye size={14} /> Ver
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </Modal>
  )
}
