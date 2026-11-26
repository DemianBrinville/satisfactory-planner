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

## Plan de implementación (acordado el 26-nov-2026)

1. ~~**Iconos:** todos los de la wiki (incluidas las variantes de arquitectura), vista ampliada al pasar el mouse e iconos dentro del plano (el producto sobre cada máquina).~~ Hecho.
2. ~~**Hipertubos completos:** trazado como tuberías (entrada, tramos, soportes, uniones en cruz y T, pases por cimientos y paredes), costo por metro y largo máximo.~~ Hecho: tramos de hasta 100 m (wiki), costo por metro (la pieza mide 1 m en los datos del juego), entrada con una conexión atrás, unión de tres vías y ramificación, soportes y agujero de pared como puntos de paso, pase por el suelo entre pisos. No entran en el cálculo de flujos. La posición de las conexiones de las uniones es aproximada (el juego no la da).
3. ~~**Rutas de vehículos con camino real:** dibujar el recorrido con puntos de paso, distancia y tiempo desde el dibujo, caminos de vehículo visibles en el plano y combustible por viaje.~~ Hecho: al crear la ruta, los clics en el suelo son puntos de paso (clic derecho quita el último); con la ruta seleccionada se arrastran, doble clic agrega o quita. La distancia sale del dibujo (o se escribe a mano). Combustible elegible por ruta: camión 75 MW, tractor 55 MW y explorador 90 MW mientras andan (datos del juego); dron 24 000 MJ + 6 MJ/m por viaje y velocidad según el combustible; 8 s de acople en estaciones de camiones y 51 s de despegue/aterrizaje del dron (wiki). Los trenes son eléctricos. Pendiente: que los trenes tomen la distancia de las vías.
4. ~~**Calculadora lista para construir:** energía (postes y cables), subproductos al AWESOME Sink o a un depósito y menos cruces de líneas.~~ Hecho: postes del mejor tipo desbloqueado en los huecos entre máquinas, encadenados por fila y entre filas (el primero, enganchado a la red del mundo), respetando las conexiones de cada poste y los 100 m por cable. Subproductos a elegir: AWESOME Sink, depósito (con el tiempo que tarda en llenarse) o sueltos; los fluidos van a un tanque porque el Sink no los acepta. Cada subproducto baja por su columna a un destino apilado a la derecha, sin cruzarse. Los carriles de ingredientes se ordenan por cuánto recorren y los de productos según sus puertos: p. ej. motor 34 → 6 cruces, conector de alta velocidad 32 → 6. Los cruces que quedan son sobre todo de máquinas con varias entradas (en el juego se salvan subiendo una línea) y se avisan en el armado.
5. ~~**Validación del plano:** choques de cintas con máquinas, pendiente máxima de 35° y panel de problemas con clic para ir al lugar.~~ Hecho: botón **Problemas** en la barra superior con la lista de todo lo que no se podría construir así: estructuras superpuestas, cintas y tuberías que atraviesan estructuras, tramos más largos que el máximo, pendiente de cinta de más de 35°, cables de más de 100 m (300 entre torres) y postes con más cables de los que admiten. Cada problema se marca en el plano y, con un clic, la vista va al piso y al lugar y lo selecciona. Los postes de cinta tienen altura (común: 1, 3, 5 o 7 m; apilable: 3, 5, 7… m, como en el juego): de ahí salen la pendiente y si la cinta pasa por encima de una máquina. La calculadora ya no pone postes de energía encima de cintas ni de máquinas: probados los 128 armados × 3 modos de subproductos, sin ningún problema.
6. ~~**Trenes:** señales, horarios y estaciones de varios andenes.~~ Hecho: la estación y sus plataformas (16 m a lo largo de la vía, como en el juego) se enganchan en fila y cada plataforma atiende al vagón de su posición; cada plataforma de carga se pone en carga o descarga. Desde una estación se crea un **tren con horario**: paradas en orden (agregar, quitar, reordenar), trenes que hacen el mismo horario, locomotoras y vagones. La distancia sale de las vías (camino más corto por la red) y la vuelta suma 27,08 s de acople por parada; el flujo pasa vagón por vagón de la plataforma de carga a la de descarga. Muestra el consumo de las locomotoras (25 a 110 MW cada una). **Señales** de bloque y de trayecto: se colocan sobre la vía, R las da vuelta. El panel de problemas avisa si dos o más trenes comparten vías sin señales, si falta vía entre dos paradas o si una señal quedó fuera de la vía. Los trenes entre dos plataformas (sin horario) también toman la distancia de las vías.
7. **Planos reutilizables:** bloques guardados para pegar en cualquier plano.
8. **Mapa real como fondo:** elegir una sección del mapa, orientarla con cualquier ángulo antes de aplicar la cuadrícula, y ver los yacimientos reales (ubicación y pureza) para ubicar cada taladro en su nodo.

Ideas propuestas, pendientes de decidir: calculadora que elige las recetas óptimas, energía automática en el armado, panel de problemas, anotaciones y regla, exportar imagen, exportar a Blueprint del juego (`.sbp`) e importar la partida (`.sav`).

## Pendientes

- **i18n:** toda la interfaz está en claves con español e inglés (~445 claves). Falta revisar el inglés con jugadores nativos y sumar más idiomas (los nombres del juego ya existen en los `Docs/*.json` de cada idioma).

- Calculadora: ubicar cada taladro sobre su yacimiento real (requiere el mapa de yacimientos) y evitar cruces de líneas.
- Mapa de yacimientos reales (ubicación y pureza de los nodos).
- Detección de choques de cintas con máquinas y pendiente máxima de 35°.
- Subproductos que bloquean (residuos nucleares, fluidos de refinería).
- Puntos del AWESOME Sink y cupones por minuto.
- Consumo de vehículos (energía de trenes, combustible de camiones y drones).
- Planos de diseño reutilizables (Blueprint Designer) y señales/horarios de tren.
