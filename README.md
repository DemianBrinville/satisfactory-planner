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

### Mapa real (yacimientos)

`src/data/map-nodes.json` sale del mapa del juego instalado: posición, recurso y pureza de los 459 yacimientos, los 31 géiseres y los 17 pozos (núcleo y 118 satélites), y los límites del mapa (del actor que captura el minimapa: 7500 m de lado). Se lee con [CUE4Parse](https://github.com/FabianFG/CUE4Parse) (.NET 10); Satisfactory 1.2 usa Unreal Engine 5.6 y el `FactoryGame.usmap` oficial de `CommunityResources`, que el extractor corrige en una copia (sus propiedades `Optional` no traen el tipo interior):

```bash
dotnet run -c Release --project scripts/map-extract -- "<ruta>/Satisfactory" map-raw.json
node scripts/build-map-data.mjs map-raw.json --image   # src/data/map-nodes.json y public/map/map.jpg
```

La imagen del mapa (`public/map/map.jpg`, 5000 × 5000 px) es la del juego publicada en la wiki oficial; es propiedad de Coffee Stain Studios. Los yacimientos son los del mundo estándar: con los modos de juego de la 1.2 que mezclan los nodos no coinciden.

### Idiomas (i18n)

- i18next + react-i18next. Toda la interfaz está traducida al español y al inglés; los textos que se arman fuera de React (notas de la calculadora, errores de la nube) usan `i18n.t` y se recalculan al cambiar de idioma porque la app se vuelve a montar. Los textos de la interfaz están en `src/i18n/locales/<idioma>/common.json` y se piden por clave (`t('topbar.calculator')`); las claves están tipadas, así que una clave inexistente no compila.
- El idioma se detecta del navegador y se guarda en `localStorage`; si el navegador pide uno no soportado se usa inglés.
- Los nombres del juego (ítems, edificios, recetas, hitos) salen de los archivos oficiales del juego en cada idioma, no de las traducciones.
- Para sumar un idioma: crear su `common.json`, agregarlo a `SUPPORTED` y `resources` en `src/i18n/index.ts` y generar sus nombres con `extract-names.mjs`.

### Supabase

- El esquema está en `supabase/migrations/`: tablas `plans`, `user_progress`, `profiles` y `blocks`, con RLS para que cada usuario vea solo lo suyo.
- El login es por enlace mágico (email). La URL del proyecto y la clave publicable son públicas por diseño y están como valores por defecto en `src/cloud/supabase.ts`. Se pueden sobreescribir con las variables `VITE_SUPABASE_*` (ver `.env.example`).

## Plan de implementación (acordado el 26-nov-2026)

1. ~~**Iconos:** todos los de la wiki (incluidas las variantes de arquitectura), vista ampliada al pasar el mouse e iconos dentro del plano (el producto sobre cada máquina).~~ Hecho.
2. ~~**Hipertubos completos:** trazado como tuberías (entrada, tramos, soportes, uniones en cruz y T, pases por cimientos y paredes), costo por metro y largo máximo.~~ Hecho: tramos de hasta 100 m (wiki), costo por metro (la pieza mide 1 m en los datos del juego), entrada con una conexión atrás, unión de tres vías y ramificación, soportes y agujero de pared como puntos de paso, pase por el suelo entre pisos. No entran en el cálculo de flujos. La posición de las conexiones de las uniones es aproximada (el juego no la da).
3. ~~**Rutas de vehículos con camino real:** dibujar el recorrido con puntos de paso, distancia y tiempo desde el dibujo, caminos de vehículo visibles en el plano y combustible por viaje.~~ Hecho: al crear la ruta, los clics en el suelo son puntos de paso (clic derecho quita el último); con la ruta seleccionada se arrastran, doble clic agrega o quita. La distancia sale del dibujo (o se escribe a mano). Combustible elegible por ruta: camión 75 MW, tractor 55 MW y explorador 90 MW mientras andan (datos del juego); dron 24 000 MJ + 6 MJ/m por viaje y velocidad según el combustible; 8 s de acople en estaciones de camiones y 51 s de despegue/aterrizaje del dron (wiki). Los trenes son eléctricos. Pendiente: que los trenes tomen la distancia de las vías.
4. ~~**Calculadora lista para construir:** energía (postes y cables), subproductos al AWESOME Sink o a un depósito y menos cruces de líneas.~~ Hecho: postes del mejor tipo desbloqueado en los huecos entre máquinas, encadenados por fila y entre filas (el primero, enganchado a la red del mundo), respetando las conexiones de cada poste y los 100 m por cable. Subproductos a elegir: AWESOME Sink, depósito (con el tiempo que tarda en llenarse) o sueltos; los fluidos van a un tanque porque el Sink no los acepta. Cada subproducto baja por su columna a un destino apilado a la derecha, sin cruzarse. Los carriles de ingredientes se ordenan por cuánto recorren y los de productos según sus puertos: p. ej. motor 34 → 6 cruces, conector de alta velocidad 32 → 6. Los cruces que quedan son sobre todo de máquinas con varias entradas (en el juego se salvan subiendo una línea) y se avisan en el armado.
5. ~~**Validación del plano:** choques de cintas con máquinas, pendiente máxima de 35° y panel de problemas con clic para ir al lugar.~~ Hecho: botón **Problemas** en la barra superior con la lista de todo lo que no se podría construir así: estructuras superpuestas, cintas y tuberías que atraviesan estructuras, tramos más largos que el máximo, pendiente de cinta de más de 35°, cables de más de 100 m (300 entre torres) y postes con más cables de los que admiten. Cada problema se marca en el plano y, con un clic, la vista va al piso y al lugar y lo selecciona. Los postes de cinta tienen altura (común: 1, 3, 5 o 7 m; apilable: 3, 5, 7… m, como en el juego): de ahí salen la pendiente y si la cinta pasa por encima de una máquina. La calculadora ya no pone postes de energía encima de cintas ni de máquinas: probados los 128 armados × 3 modos de subproductos, sin ningún problema.
6. ~~**Trenes:** señales, horarios y estaciones de varios andenes.~~ Hecho: la estación y sus plataformas (16 m a lo largo de la vía, como en el juego) se enganchan en fila y cada plataforma atiende al vagón de su posición; cada plataforma de carga se pone en carga o descarga. Desde una estación se crea un **tren con horario**: paradas en orden (agregar, quitar, reordenar), trenes que hacen el mismo horario, locomotoras y vagones. La distancia sale de las vías (camino más corto por la red) y la vuelta suma 27,08 s de acople por parada; el flujo pasa vagón por vagón de la plataforma de carga a la de descarga. Muestra el consumo de las locomotoras (25 a 110 MW cada una). **Señales** de bloque y de trayecto: se colocan sobre la vía, R las da vuelta. El panel de problemas avisa si dos o más trenes comparten vías sin señales, si falta vía entre dos paradas o si una señal quedó fuera de la vía. Los trenes entre dos plataformas (sin horario) también toman la distancia de las vías.
7. ~~**Planos reutilizables:** bloques guardados para pegar en cualquier plano.~~ Hecho: clic derecho sobre una selección → **Guardar como bloque** (nombre y descripción). Se guardan las estructuras con receta, reloj, filtros y alturas, las cintas y tuberías entre ellas, los cables y las vías seleccionadas. La pestaña **Bloques** de la paleta (como la de planos del menú de construcción) los lista con un dibujo, medidas y en qué Diseñador de planos entrarían (Mk.1 32 m, Mk.2 40 m, Mk.3 48 m); un clic lo coloca en el piso actual, R lo gira. Se guardan en el navegador y, con sesión iniciada, en la cuenta (tabla `blocks`, migración `003_blocks.sql`); se exportan e importan como archivo `.block.json`. Copiar y pegar ahora también lleva cables y vías, gira los postes con el grupo y mantiene los pisos que suben las elevadoras.
8. ~~**Mapa real como fondo:** elegir una sección del mapa, orientarla con cualquier ángulo antes de aplicar la cuadrícula, y ver los yacimientos reales (ubicación y pureza) para ubicar cada taladro en su nodo.~~ Hecho: botón **Mapa** en la barra superior. En una ventana con el mapa del juego (zoom con la rueda, arrastrar para moverse) se hace clic donde se quiere construir y el plano aparece centrado ahí, dibujado con lo que ya tiene; se arrastra para moverlo y se gira desde su centro con una manija (con Shift, de a 15°), como en un editor de imágenes, sin cambiar su tamaño. El plano muestra el terreno de fondo (opacidad ajustable) y los yacimientos reales con color por recurso, icono y pureza (I/N/P); los pozos se ven como anillos de satélites alrededor de su núcleo. Al colocar un taladro, extractor de petróleo, extractor de pozo, presurizador o generador geotérmico cerca de un yacimiento compatible se pone encima y toma el recurso y la pureza del juego; el panel lo indica y ofrece corregirlos si no coinciden. El panel de problemas avisa los extractores que no están sobre un yacimiento o que tienen otro recurso o pureza. Los datos salen del juego instalado (ver "Mapa real" arriba). La ubicación se guarda con el plano y no entra en deshacer.

Ideas propuestas, pendientes de decidir: calculadora que elige las recetas óptimas, energía automática en el armado, panel de problemas, anotaciones y regla, exportar imagen, exportar a Blueprint del juego (`.sbp`) e importar la partida (`.sav`).

## Otras mejoras

- **Superficies de cimientos:** al pasar el mouse por un cimiento se marca toda la superficie de piezas contiguas (de cualquier forma, p. ej. una L), con la medida de cada lado en metros y en cimientos, la cantidad de piezas por tipo y si es un rectángulo (7 × 4) o una forma irregular.
- **Calculadora:** las troncales laterales van pegadas a las filas que acompañan en vez de al ancho de la fila más ancha (36 % menos de cinta en 90 armados de prueba, sin problemas nuevos). Los taladros usan la marca más barata que alcanza: 36/min de carbón es un Mk.1, no un Mk.2 al 30 %, y el último taladro de un grupo, que queda a menos del 100 %, también puede ser de una marca menor.

## Pendientes

- **i18n:** toda la interfaz está en claves con español e inglés (~445 claves). Falta revisar el inglés con jugadores nativos y sumar más idiomas (los nombres del juego ya existen en los `Docs/*.json` de cada idioma).

- Calculadora: ubicar cada taladro sobre su yacimiento real (ya están los datos del mapa) y evitar cruces de líneas.
- Detección de choques de cintas con máquinas y pendiente máxima de 35°.
- Subproductos que bloquean (residuos nucleares, fluidos de refinería).
- Puntos del AWESOME Sink y cupones por minuto.
- Consumo de vehículos (energía de trenes, combustible de camiones y drones).
