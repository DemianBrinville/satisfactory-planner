import i18n from '../i18n'
import type { User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { useProgress } from '../editor/progress'
import { snapshot, useEditor, type PlanDoc } from '../editor/store'
import { supabase } from './supabase'

export interface PlanMeta {
  id: string
  name: string
  updated_at: string
  is_public?: boolean
  description?: string | null
}

export interface Profile {
  id: string
  username: string | null
  display_name: string | null
  bio: string | null
}

/** Plano público de la comunidad con su autor. */
export interface PublicPlan extends PlanMeta {
  user_id: string
  author: Profile | null
  /** cantidad de estructuras (para la tarjeta) */
  size?: number
}

export type AuthMode = 'login' | 'signup' | 'reset'

type SaveState = 'local' | 'saving' | 'saved' | 'error'

interface CloudState {
  ready: boolean
  user: User | null
  plans: PlanMeta[]
  currentId: string | null
  currentName: string
  saveState: SaveState
  error: string | null

  /** recuperación de contraseña: el usuario volvió desde el enlace del correo */
  recovering: boolean
  /** ventana de inicio de sesión abierta (y en qué pestaña) */
  authOpen: AuthMode | null
  openAuth: (mode: AuthMode | null) => void
  profile: Profile | null
  updateProfile: (patch: Partial<Profile>) => Promise<boolean>
  setPlanPublic: (id: string, isPublic: boolean, description?: string) => Promise<void>
  listPublic: (search?: string) => Promise<PublicPlan[]>
  /** plano de la comunidad abierto en modo vista (no se guarda) */
  viewing: { id: string; name: string; author: string } | null
  viewPublic: (plan: PublicPlan) => Promise<void>
  copyViewing: () => Promise<void>
  exitView: () => Promise<void>
  signIn: (email: string, password: string) => Promise<boolean>
  signInWithGoogle: () => Promise<void>
  signUp: (email: string, password: string) => Promise<'session' | 'confirm' | null>
  resetPassword: (email: string) => Promise<boolean>
  updatePassword: (password: string) => Promise<boolean>
  signOut: () => Promise<void>
  refreshPlans: () => Promise<void>
  openPlan: (id: string) => Promise<void>
  newPlan: (name: string, fromCurrent?: boolean) => Promise<void>
  renameCurrent: (name: string) => Promise<void>
  deletePlan: (id: string) => Promise<void>
}

const CURRENT_KEY = 'satisfactory-planner:current-plan'
/** Vuelve a la misma página (y no a la raíz) después de confirmar el correo o recuperar la contraseña. */
const returnUrl = () => window.location.origin + window.location.pathname

/** Mensajes de Supabase Auth en español. */
function authError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return i18n.t('cloud.badLogin')
  if (/Email not confirmed/i.test(msg)) return i18n.t('cloud.notConfirmed')
  if (/already registered|already been registered/i.test(msg)) return i18n.t('cloud.exists')
  if (/at least 6|Password should/i.test(msg)) return i18n.t('cloud.shortPassword')
  if (/rate limit|too many/i.test(msg)) return i18n.t('cloud.rateLimit')
  return msg
}
const docOf = (): PlanDoc => {
  const s = useEditor.getState()
  return { ...snapshot(s), floorHeight: s.floorHeight }
}

export const useCloud = create<CloudState>((set, get) => ({
  ready: false,
  user: null,
  plans: [],
  currentId: null,
  currentName: '',
  saveState: 'local',
  error: null,
  recovering: false,
  authOpen: null,
  openAuth: (authOpen) => set({ authOpen, error: null }),
  profile: null,
  viewing: null,

  updateProfile: async (patch) => {
    const user = get().user
    if (!user) return false
    set({ error: null })
    const { data, error } = await supabase
      .from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select('id,username,display_name,bio')
      .single()
    if (error) {
      set({ error: /duplicate|unique/i.test(error.message) ? i18n.t('cloud.usernameTaken') : /check/i.test(error.message) ? i18n.t('cloud.usernameFormat') : error.message })
      return false
    }
    set({ profile: data })
    return true
  },

  setPlanPublic: async (id, isPublic, description) => {
    const patch: Record<string, unknown> = { is_public: isPublic }
    if (description !== undefined) patch.description = description
    const { error } = await supabase.from('plans').update(patch).eq('id', id)
    if (error) set({ error: error.message })
    await get().refreshPlans()
  },

  listPublic: async (search) => {
    let q = supabase.from('plans').select('id,name,description,updated_at,user_id,data').eq('is_public', true).order('updated_at', { ascending: false }).limit(60)
    if (search?.trim()) q = q.ilike('name', `%${search.trim()}%`)
    const { data, error } = await q
    if (error || !data) {
      set({ error: error?.message ?? null })
      return []
    }
    const ids = [...new Set(data.map((p) => p.user_id))]
    const { data: profiles } = ids.length ? await supabase.from('profiles').select('id,username,display_name,bio').in('id', ids) : { data: [] }
    return data.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      updated_at: p.updated_at,
      user_id: p.user_id,
      size: (p.data as PlanDoc)?.entities?.length ?? 0,
      author: (profiles ?? []).find((x) => x.id === p.user_id) ?? null,
    }))
  },

  viewPublic: async (plan) => {
    const { data, error } = await supabase.from('plans').select('data').eq('id', plan.id).single()
    if (error || !data) {
      set({ error: error?.message ?? i18n.t('cloud.openFailed') })
      return
    }
    suppressSave = true
    useEditor.getState().load(data.data as PlanDoc)
    suppressSave = false
    const author = plan.author?.display_name || (plan.author?.username ? '@' + plan.author.username : i18n.t('cloud.otherPlayer'))
    set({ viewing: { id: plan.id, name: plan.name, author }, currentId: null, currentName: plan.name, saveState: 'local' })
  },

  copyViewing: async () => {
    const v = get().viewing
    if (!v) return
    if (!get().user) {
      // sin sesión: queda como borrador local; al entrar se guarda en la cuenta
      set({ viewing: null, currentName: v.name + ' (copia)' })
      return
    }
    const { data, error } = await supabase
      .from('plans')
      .insert({ name: v.name + ' (copia)', data: docOf(), copied_from: v.id })
      .select('id')
      .single()
    if (error || !data) {
      set({ error: error?.message ?? i18n.t('cloud.copyFailed') })
      return
    }
    set({ viewing: null })
    await get().refreshPlans()
    await get().openPlan(data.id)
  },

  exitView: async () => {
    set({ viewing: null })
    const last = localStorage.getItem(CURRENT_KEY)
    if (get().user && last) return get().openPlan(last)
    suppressSave = true
    useEditor.getState().load({ entities: [], conveyors: [] })
    suppressSave = false
    set({ currentName: '' })
  },

  signIn: async (email, password) => {
    set({ error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ error: authError(error.message) })
      return false
    }
    return true
  },

  signInWithGoogle: async () => {
    set({ error: null })
    // vuelve a la misma página; lo dibujado sin sesión queda en el navegador y se guarda al entrar
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } })
    if (error) set({ error: /provider is not enabled|Unsupported provider/i.test(error.message) ? i18n.t('cloud.googleDisabled') : error.message })
  },

  signUp: async (email, password) => {
    set({ error: null })
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl() } })
    if (error) {
      set({ error: authError(error.message) })
      return null
    }
    return data.session ? 'session' : 'confirm'
  },

  resetPassword: async (email) => {
    set({ error: null })
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: returnUrl() })
    if (error) {
      set({ error: authError(error.message) })
      return false
    }
    return true
  },

  updatePassword: async (password) => {
    set({ error: null })
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      set({ error: authError(error.message) })
      return false
    }
    set({ recovering: false })
    return true
  },

  signOut: async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(CURRENT_KEY)
    // el plano queda guardado en la cuenta; el lienzo vuelve a un borrador vacío
    suppressSave = true
    useEditor.getState().load({ entities: [], conveyors: [] })
    suppressSave = false
    set({ user: null, profile: null, viewing: null, plans: [], currentId: null, currentName: '', saveState: 'local' })
  },

  refreshPlans: async () => {
    const user = get().user
    if (!user) return
    const { data, error } = await supabase
      .from('plans')
      .select('id,name,updated_at,is_public,description')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
    if (error) set({ error: error.message })
    else set({ plans: data ?? [] })
  },

  openPlan: async (id) => {
    const { data, error } = await supabase.from('plans').select('id,name,data').eq('id', id).single()
    if (error || !data) {
      set({ error: error?.message ?? i18n.t('cloud.notFound') })
      return
    }
    suppressSave = true
    useEditor.getState().load(data.data as PlanDoc)
    suppressSave = false
    localStorage.setItem(CURRENT_KEY, id)
    set({ currentId: id, currentName: data.name, saveState: 'saved', viewing: null })
  },

  newPlan: async (name, fromCurrent = false) => {
    const doc: PlanDoc = fromCurrent ? docOf() : { entities: [], conveyors: [] }
    const { data, error } = await supabase.from('plans').insert({ name, data: doc }).select('id,name').single()
    if (error || !data) {
      set({ error: error?.message ?? i18n.t('cloud.createFailed') })
      return
    }
    await get().refreshPlans()
    await get().openPlan(data.id)
  },

  renameCurrent: async (name) => {
    const id = get().currentId
    if (!id) return
    set({ currentName: name })
    const { error } = await supabase.from('plans').update({ name, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) set({ error: error.message })
    else get().refreshPlans()
  },

  deletePlan: async (id) => {
    const { error } = await supabase.from('plans').delete().eq('id', id)
    if (error) {
      set({ error: error.message })
      return
    }
    if (get().currentId === id) {
      localStorage.removeItem(CURRENT_KEY)
      set({ currentId: null, currentName: '', saveState: 'local' })
    }
    get().refreshPlans()
  },
}))

// ---------- autoguardado del plano abierto ----------
let suppressSave = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
useEditor.subscribe((s, prev) => {
  if (suppressSave || (s.entities === prev.entities && s.conveyors === prev.conveyors && s.wires === prev.wires && s.rails === prev.rails && s.routes === prev.routes && s.power === prev.power && s.floorHeight === prev.floorHeight)) return
  const { currentId } = useCloud.getState()
  if (!currentId) return
  useCloud.setState({ saveState: 'saving' })
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const { error } = await supabase
      .from('plans')
      .update({ data: docOf(), updated_at: new Date().toISOString() })
      .eq('id', currentId)
    useCloud.setState({ saveState: error ? 'error' : 'saved', error: error?.message ?? null })
  }, 1200)
})

// ---------- progreso sincronizado ----------
let progressReady = false
let progressTimer: ReturnType<typeof setTimeout> | undefined
useProgress.subscribe((s) => {
  const user = useCloud.getState().user
  if (!progressReady || !user) return
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    supabase
      .from('user_progress')
      .upsert({ user_id: user.id, data: { enabled: s.enabled, phase: s.phase, unlocked: s.unlocked }, updated_at: new Date().toISOString() })
      .then(({ error }) => error && useCloud.setState({ error: error.message }))
  }, 800)
})

/** Nombre de usuario inicial a partir del nombre o del email (se puede cambiar en el perfil). */
function suggestUsername(user: User): string {
  const base = String(user.user_metadata?.full_name || user.email?.split('@')[0] || 'pionero')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '')
    .slice(0, 16)
  return (base.length >= 3 ? base : 'pionero') + Math.floor(1000 + Math.random() * 9000)
}

async function loadProfile(user: User) {
  const { data } = await supabase.from('profiles').select('id,username,display_name,bio').eq('id', user.id).maybeSingle()
  if (data) return useCloud.setState({ profile: data })
  const fresh = { id: user.id, username: suggestUsername(user), display_name: user.user_metadata?.full_name ?? null, bio: null }
  const { data: created } = await supabase.from('profiles').insert(fresh).select('id,username,display_name,bio').single()
  useCloud.setState({ profile: created ?? fresh })
}

async function onLogin(user: User) {
  useCloud.setState({ user, authOpen: null })
  loadProfile(user)
  // progreso: si hay uno en la nube se usa; si no, se sube el local
  const { data } = await supabase.from('user_progress').select('data').maybeSingle()
  if (data?.data && Object.keys(data.data).length) useProgress.getState().load(data.data)
  else {
    const p = useProgress.getState()
    await supabase.from('user_progress').upsert({ user_id: user.id, data: { enabled: p.enabled, phase: p.phase, unlocked: p.unlocked } })
  }
  progressReady = true
  await useCloud.getState().refreshPlans()
  const last = localStorage.getItem(CURRENT_KEY)
  const plans = useCloud.getState().plans
  const local = docOf()
  const hasLocalWork = local.entities.length + local.conveyors.length > 0
  if (last && plans.some((p) => p.id === last)) {
    // recarga con sesión abierta: se sigue con el plano en el que estaba
    await useCloud.getState().openPlan(last)
  } else if (hasLocalWork || !plans.length) {
    // lo que dibujó antes de entrar no se pierde: pasa a ser un plano de su cuenta
    await useCloud.getState().newPlan(plans.length ? i18n.t('cloud.unsaved') : i18n.t('cloud.firstFactory'), true)
  } else {
    await useCloud.getState().openPlan(plans[0].id)
  }
}

supabase.auth.getSession().then(async ({ data }) => {
  if (data.session?.user) await onLogin(data.session.user)
  useCloud.setState({ ready: true })
})
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') useCloud.setState({ recovering: true })
  if (event === 'SIGNED_IN' && session?.user && useCloud.getState().user?.id !== session.user.id) onLogin(session.user)
  if (event === 'SIGNED_OUT') {
    progressReady = false
    useCloud.setState({ user: null })
  }
})
