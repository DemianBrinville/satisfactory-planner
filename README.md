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

### Nombres en inglés e iconos

```bash
node scripts/extract-names.mjs "<ruta>/Satisfactory/CommunityResources/Docs/en-US.json"   # src/data/game-names-en.json
node scripts/fetch-wiki-icons.mjs [--force]   # public/icons/*.png y src/data/icon-manifest.json
```

Los iconos de ítems y edificios son propiedad de Coffee Stain Studios y se toman de la [wiki oficial de Satisfactory](https://satisfactory.wiki.gg). Lo que no tiene imagen en la wiki usa los dibujos propios de `src/components/GameIcons.tsx`.

### Idiomas (i18n)

- i18next + react-i18next. Toda la interfaz está traducida al español y al inglés; los textos que se arman fuera de React (notas de la calculadora, errores de la nube) usan `i18n.t` y se recalculan al cambiar de idioma porque la app se vuelve a montar. Los textos de la interfaz están en `src/i18n/locales/<idioma>/common.json` y se piden por clave (`t('topbar.calculator')`); las claves están tipadas, así que una clave inexistente no compila.
- El idioma se detecta del navegador y se guarda en `localStorage`; si el navegador pide uno no soportado se usa inglés.
- Los nombres del juego (ítems, edificios, recetas, hitos) salen de los archivos oficiales del juego en cada idioma, no de las traducciones.
- Para sumar un idioma: crear su `common.json`, agregarlo a `SUPPORTED` y `resources` en `src/i18n/index.ts` y generar sus nombres con `extract-names.mjs`.

### Supabase

- El esquema está en `supabase/migrations/`: tablas `plans` y `user_progress`, con RLS para que cada usuario vea solo lo suyo.
- El login es por enlace mágico (email). La URL del proyecto y la clave publicable son públicas por diseño y están como valores por defecto en `src/cloud/supabase.ts`. Se pueden sobreescribir con las variables `VITE_SUPABASE_*` (ver `.env.example`).

## Pendientes

- **i18n:** toda la interfaz está en claves con español e inglés (~445 claves). Falta revisar el inglés con jugadores nativos y sumar más idiomas (los nombres del juego ya existen en los `Docs/*.json` de cada idioma).

- Iconos propios dentro del plano (sobre cada máquina, el producto de su receta).
- Calculadora: ubicar cada taladro sobre su yacimiento real (requiere el mapa de yacimientos) y evitar cruces de líneas.
- Mapa de yacimientos reales (ubicación y pureza de los nodos).
- Detección de choques de cintas con máquinas y pendiente máxima de 35°.
- Subproductos que bloquean (residuos nucleares, fluidos de refinería).
- Puntos del AWESOME Sink y cupones por minuto.
- Consumo de vehículos (energía de trenes, combustible de camiones y drones).
- Planos de diseño reutilizables (Blueprint Designer) y señales/horarios de tren.
