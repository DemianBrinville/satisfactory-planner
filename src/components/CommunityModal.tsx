import { locale } from '../i18n/format'
import { Trans, useTranslation } from 'react-i18next'
import { Boxes, Eye, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCloud, type PublicPlan } from '../cloud/cloud'
import Modal from './Modal'

/** Planos que comparten los jugadores: se abren en modo vista y se puede guardar una copia. */
export default function CommunityModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { listPublic, viewPublic, user, profile } = useCloud()
  const [query, setQuery] = useState('')
  const [plans, setPlans] = useState<PublicPlan[] | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => listPublic(query).then(setPlans), 250)
    return () => clearTimeout(timer)
  }, [query, listPublic])

  return (
    <Modal title={t('community.title')} onClose={onClose} width={860}>
      <div className="input-icon">
        <Search size={16} className="lead" />
        <input placeholder={t('community.search')} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      {!user && <p className="muted small">{t('community.guestHint')}</p>}
      {plans === null && <p className="muted">{t('common.loading')}</p>}
      {plans?.length === 0 && (
        <p className="muted">
          <Trans i18nKey={query ? 'community.emptyQuery' : 'community.empty'} components={{ b: <b /> }} />
        </p>
      )}
      <div className="cards">
        {plans?.map((p) => {
          const mine = p.user_id === profile?.id
          const author = p.author?.display_name || (p.author?.username ? '@' + p.author.username : t('community.anonymous'))
          return (
            <article key={p.id} className="card">
              <h3>{p.name}</h3>
              <p className="card-author">
                {author}
                {mine && <span className="tag">{t('community.yours')}</span>}
              </p>
              {p.description && <p className="card-desc">{p.description}</p>}
              <div className="card-foot">
                <span className="muted small">
                  <Boxes size={14} /> {t('community.structures', { count: p.size })} · {new Date(p.updated_at).toLocaleDateString(locale())}
                </span>
                <button
                  className="btn sm primary"
                  onClick={async () => {
                    await viewPublic(p)
                    onClose()
                  }}
                >
                  <Eye size={14} /> {t('community.view')}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </Modal>
  )
}
