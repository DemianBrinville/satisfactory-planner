import { createClient } from '@supabase/supabase-js'

// La URL y la clave publicable son públicas por diseño (van dentro del bundle del navegador);
// la seguridad de los datos la dan las políticas RLS de cada tabla. Se pueden sobreescribir con
// variables de entorno VITE_* (ver .env.example).
const url = import.meta.env.VITE_SUPABASE_URL || 'https://vltqtjggvedrttcllacv.supabase.co'
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__VWo4Up8KGZ3YhM0KyGrBQ_hOU-aIwl'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
