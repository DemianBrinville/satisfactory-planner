import type { User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { useProgress } from '../editor/progress'
import { snapshot, useEditor, type PlanDoc } from '../editor/store'
import { supabase } from './supabase'

export interface PlanMeta {
  id: string
  name: string
  updated_at: string
}

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
  signIn: (email: string, password: string) => Promise<boolean>
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
  if (/Invalid login credentials/i.test(msg)) return 'Email o contraseña incorrectos.'
  if (/Email not confirmed/i.test(msg)) return 'Todavía no confirmaste el email: revisa tu correo.'
  if (/already registered|already been registered/i.test(msg)) return 'Ya existe una cuenta con ese email: inicia sesión.'
  if (/at least 6|Password should/i.test(msg)) return 'La contraseña debe tener al menos 6 caracteres.'
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos seguidos: espera unos minutos.'
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
  currentName: 'Borrador local',
  saveState: 'local',
  error: null,
  recovering: false,

  signIn: async (email, password) => {
    set({ error: null })
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ error: authError(error.message) })
      return false
    }
    return true
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
    set({ user: null, plans: [], currentId: null, currentName: 'Borrador local', saveState: 'local' })
  },

  refreshPlans: async () => {
    const { data, error } = await supabase.from('plans').select('id,name,updated_at').order('updated_at', { ascending: false })
    if (error) set({ error: error.message })
    else set({ plans: data ?? [] })
  },

  openPlan: async (id) => {
    const { data, error } = await supabase.from('plans').select('id,name,data').eq('id', id).single()
    if (error || !data) {
      set({ error: error?.message ?? 'No se encontró el plano' })
      return
    }
    suppressSave = true
    useEditor.getState().load(data.data as PlanDoc)
    suppressSave = false
    localStorage.setItem(CURRENT_KEY, id)
    set({ currentId: id, currentName: data.name, saveState: 'saved' })
  },

  newPlan: async (name, fromCurrent = false) => {
    const doc: PlanDoc = fromCurrent ? docOf() : { entities: [], conveyors: [] }
    const { data, error } = await supabase.from('plans').insert({ name, data: doc }).select('id,name').single()
    if (error || !data) {
      set({ error: error?.message ?? 'No se pudo crear el plano' })
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
      set({ currentId: null, currentName: 'Borrador local', saveState: 'local' })
    }
    get().refreshPlans()
  },
}))

// ---------- autoguardado del plano abierto ----------
let suppressSave = false
let saveTimer: ReturnType<typeof setTimeout> | undefined
useEditor.subscribe((s, prev) => {
  if (suppressSave || (s.entities === prev.entities && s.conveyors === prev.conveyors && s.wires === prev.wires && s.rails === prev.rails && s.routes === prev.routes && s.floorHeight === prev.floorHeight)) return
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

async function onLogin(user: User) {
  useCloud.setState({ user })
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
    await useCloud.getState().newPlan(plans.length ? 'Plano sin guardar' : 'Mi primera fábrica', true)
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
