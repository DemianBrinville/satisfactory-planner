# Satisfactory Planner

Planificador 2D (vista cenital) de fábricas para **Satisfactory 1.x**.

- Cuadrícula de 1 m × 1 m (un cimiento de 1 m); los cimientos del juego son de 8 m × 8 m.
- Máquinas y estructuras dibujadas a escala real, con sus puertos de entrada y salida para cintas y tuberías.
- Trazado asistido de cintas transportadoras y tuberías.
- Pisos o capas para construir en vertical.
- Resumen de costo en materiales y de superficie ocupada.
- Planos guardados en Supabase, con inicio de sesión.

## Stack

React 19, TypeScript, Vite, Konva (react-konva), Zustand y Supabase. Se publica en Vercel.

## Desarrollo

```bash
npm install
npm run dev
```

### Datos del juego

`src/data/game-data.json` se genera a partir del `es-ES.json` oficial del juego (nombres, costos, recetas, huellas y progreso) y de la wiki (cantidad de puertos):

```bash
node scripts/extract-game-data.mjs "<ruta>/Satisfactory/CommunityResources/Docs/es-ES.json" [--refresh-wiki]
```

### Supabase

- El esquema está en `supabase/migrations/`: tablas `plans` y `user_progress`, con RLS para que cada usuario vea solo lo suyo.
- El login es por enlace mágico (email). La URL del proyecto y la clave publicable son públicas por diseño y están como valores por defecto en `src/cloud/supabase.ts`. Se pueden sobreescribir con las variables `VITE_SUPABASE_*` (ver `.env.example`).
