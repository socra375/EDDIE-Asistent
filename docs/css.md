# CSS — sistema visual y theming

Eddie no usa un framework de CSS (ni Tailwind ni una librería de
componentes): es CSS plano, organizado por convención en dos capas.

## 1. Capa global — `src/index.css`

Se importa una sola vez, desde `src/main.jsx`, y define:

### Variables de tema (custom properties)

Todo color, radio de borde, sombra y fuente sale de variables definidas en
`:root`. Esto es lo que permite cambiar de tema oscuro/claro sin tocar
ningún componente:

```css
:root {
  color-scheme: dark;
  --bg: #020b10;
  --bg-gradient: radial-gradient(...); /* halo cian detrás del contenido */
  --accent: #3fe8ff;
  --accent-2: #b9f7ff;
  --accent-dim: #0a7f99;
  --text: #d6fbff;
  --text-dim: #6fd3e6;
  --danger: #ff4b4b;
  --success: #4dffa6;
  --warning: #ffb020;
  --radius-sm: 2px;
  --radius-lg: 4px;
  --font-mono: 'DejaVu Sans Mono', ui-monospace, ...;
  /* ...etc */
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: #eef2fb;
  --accent: #1c7fd6;
  --text: #101a2c;
  /* redefine las mismas variables con la paleta clara */
}
```

La paleta oscura es la del HUD (estilo Iron Man): fondo casi negro, cian
como color principal, ámbar para "procesando" y rojo para errores. Toda la
interfaz usa la fuente monoespaciada `--font-mono` en mayúsculas con letras
espaciadas; solo el texto largo de las respuestas (`.rich-text__paragraph`)
sigue en `--font-sans` para leerse cómodo.

El tema **oscuro es el valor por defecto** (declarado en `:root` sin
selector adicional). El tema claro solo sobreescribe las variables que
cambian, bajo el selector `:root[data-theme='light']`.

### ¿Cómo se activa el tema claro?

No hay JavaScript que cambie colores directamente. `SettingsContext`
(`src/context/SettingsContext.jsx`) hace lo mínimo:

```js
useEffect(() => {
  document.documentElement.dataset.theme = settings.theme; // 'dark' | 'light'
}, [settings.theme]);
```

Eso añade `data-theme="light"` (o `"dark"`) al `<html>`, y el CSS ya
declarado en `index.css` hace el resto vía cascada de variables. Ningún
componente necesita saber en qué tema está: solo usan `var(--accent)`,
`var(--text)`, etc.

### Clases utilitarias reutilizables

Definidas una vez en `index.css` y usadas en todos los módulos:

| Clase | Uso |
| --- | --- |
| `.glass-panel` | Panel HUD: fondo cian muy tenue, borde fino y esquinas iluminadas (`::before`/`::after`). Todos los módulos lo heredan sin cambios propios |
| `.btn` | Botón base: transparente, borde `--accent`, mayúsculas con letras espaciadas |
| `.btn-primary` | Botón de acción principal (relleno tenue + brillo `--glow`) |
| `.btn-danger` | Botón destructivo, contorno rojo (borrar memoria, borrar historial) |
| `.input`, `.select`, `.textarea` | Controles de formulario con el mismo estilo de borde/fondo/focus |
| `.field-label` | Etiqueta pequeña en mayúsculas sobre un campo |
| `.rich-text__paragraph`, `.code-block` | Usadas por `RichText.jsx` para renderizar la respuesta de Eddie, distinguiendo párrafos normales de bloques de código |

Esto evita repetir estilos de botón/input en cada módulo: `ChatPanel`,
`TasksPanel`, `SettingsPanel`, etc. todos comparten `className="btn"` /
`className="input"`.

## 2. Capa por componente — un `.css` junto a cada `.jsx`

Cada carpeta de módulo en `src/components/` tiene su propio archivo CSS,
importado directamente en el componente:

```
src/components/Chat/
├── ChatPanel.jsx
└── Chat.css          ← import './Chat.css' dentro de ChatPanel.jsx
```

Esto se repite para `Core/`, `Tasks/`, `Settings/`, y para `src/layout/`
y `src/home/`. Como Vite no hace scope automático de
CSS (no son CSS Modules), la convención para evitar colisiones es prefijar
las clases con el nombre del bloque, estilo BEM ligero:

```css
/* Tasks.css */
.tasks-panel { ... }
.tasks-form { ... }
.task-item { ... }
.task-item--done { ... }        /* modificador */
.task-item__meta { ... }        /* elemento hijo */
```

Si necesitas añadir un módulo nuevo, sigue el mismo patrón: un archivo
`NombreModulo.css` con todas sus clases prefijadas por
`.nombre-modulo` para que no choquen con las de otros paneles.

## 3. El núcleo animado — `EddieCore.css`

Es el CSS más particular del proyecto: usa `data-state` en el contenedor
para seleccionar qué animación aplicar a los anillos y al núcleo:

```css
.eddie-core[data-state='listening'] .ring { animation: wave 1.1s ...; }
.eddie-core[data-state='processing'] .ring { animation: spin 1.4s ...; }
.eddie-core[data-state='error'] .eddie-core__nucleus { animation: shake 0.4s ...; }
```

`EddieCore.jsx` simplemente pone `data-state={state}` en el `div` raíz; el
CSS decide qué `@keyframes` correr para cada estado (`idle`, `listening`,
`processing`, `responding`, `error`). También respeta
`prefers-reduced-motion: reduce`, desactivando todas las animaciones para
quien lo tenga configurado en el sistema.

## 4. Responsive

No hay un framework de grid: cada pantalla usa CSS Grid o Flexbox con
breakpoints propios. El chat usa además una container query, porque vive
en dos lugares de distinto ancho (su módulo y el panel lateral de Inicio):

```css
.chat-panel { container-type: inline-size; }

@container (max-width: 560px) {
  .chat-new__label { display: none; } /* "Nueva" queda solo con el ícono */
}
```

El layout general (`Layout.css`) tiene dos cortes:

- Bajo `1100px` (tablets y Chromebooks pequeños) la grilla pasa a dos
  columnas (barra + contenido) y "Mis chats" se vuelve un panel que se
  desliza sobre el contenido, con fondo oscurecido. Se cierra con el
  botón de la barra, tocando el fondo, con Escape o al elegir un chat.
- Bajo `860px` la barra de íconos pasa abajo (como una tab bar nativa),
  el encabezado se compacta (logo más chico y sin los chips de reloj, red
  y GPS) y "Mis chats" se abre desde la izquierda sobre la barra.

La pantalla de Inicio (`src/home/Home.css`) conserva sus tres columnas,
más angostas, hasta `960px`; debajo pasa a una sola, con el anillo primero
y los botones flotantes fijos. En Tareas, bajo `640px`, la fecha, la
prioridad y los botones bajan debajo del título.

Todo lo clicable muestra un anillo `--accent` al enfocarse con el teclado
(`:focus-visible` en `index.css`), sin afectar los clics con el mouse.

## 5. Efectos HUD y pantalla de Inicio

- `src/layout/HudFx.jsx` + `Layout.css`: capa fija con rejilla hexagonal,
  líneas de escaneo, viñeta y marco de esquinas. Lleva
  `pointer-events: none`, así nunca bloquea clics, y se oculta en el tema
  claro.
- `src/home/Home.css`: paneles con el título montado sobre el borde
  (`.hud-panel__title`), filas etiqueta/valor (`.hud-row`) y el anillo de
  Eddie. El anillo usa tres variables propias (`--ring`, `--ring-soft`,
  `--ring-dim`) que cada estado redefine en `.eddie-ring[data-state=...]`:
  `idle` (giro lento de 120 s y núcleo que respira), `listening` (barras de
  onda y pulso del núcleo), `processing` (ámbar, arcos girando en 1,4 s),
  `speaking` (brillo que late), `disabled` (gris, opacidad baja) y `error`
  (rojo con tres destellos). `prefers-reduced-motion` las apaga todas.

## Resumen de convenciones al añadir estilos nuevos

1. ¿Es un color, radio, sombra o fuente? → añade/usa una variable en
   `:root` de `index.css`, nunca un valor fijo dentro de un componente.
2. ¿Es un botón, input o panel genérico? → reutiliza `.btn`, `.input`,
   `.glass-panel`; no crees una clase nueva para lo mismo.
3. ¿Es específico de un módulo? → va en su propio `Modulo.css`, con clases
   prefijadas `.modulo-*`.
4. ¿Cambia según el tema? → nunca lo hagas con JS; define la variable en
   ambos bloques (`:root` y `:root[data-theme='light']`) y deja que la
   cascada la resuelva.
