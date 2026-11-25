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

Los datos del juego (medidas, puertos y costos) están en `src/data/` y se tomaron de la wiki oficial de Satisfactory.
