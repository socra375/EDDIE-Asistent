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
  --bg: #060a12;
  --accent: #4fd6ff;
  --accent-2: #8b6bff;
  --text: #e8f2ff;
  --text-dim: #8ea3c0;
  --danger: #ff6b81;
  --success: #4fffa8;
  --warning: #ffcf5c;
  --radius-sm: 8px;
  --radius-lg: 22px;
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
| `.glass-panel` | El panel translúcido con blur que da el aspecto "HUD" (fondo semitransparente, borde sutil, `backdrop-filter: blur`) |
| `.btn` | Botón base |
| `.btn-primary` | Botón de acción principal (gradiente `--accent` → `--accent-2`) |
| `.btn-danger` | Botón destructivo (borrar memoria, borrar historial) |
| `.input`, `.select`, `.textarea` | Controles de formulario con el mismo estilo de borde/fondo/focus |
| `.field-label` | Etiqueta pequeña en mayúsculas sobre un campo |
| `.rich-text__paragraph`, `.code-block` | Usadas por `RichText.jsx` para renderizar la respuesta de Eddie, distinguiendo párrafos normales de bloques de código |

Esto evita repetir estilos de botón/input en cada módulo: `ChatPanel`,
`StudyPanel`, `CodePanel`, etc. todos comparten `className="btn"` /
`className="input"`.

## 2. Capa por componente — un `.css` junto a cada `.jsx`

Cada carpeta de módulo en `src/components/` tiene su propio archivo CSS,
importado directamente en el componente:

```
src/components/Chat/
├── ChatPanel.jsx
└── Chat.css          ← import './Chat.css' dentro de ChatPanel.jsx
```

Esto se repite para `Core/`, `Layout/`, `Voice/`, `Study/`, `Code/`,
`Tasks/`, `Documents/`, `Settings/`. Como Vite no hace scope automático de
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

No hay un framework de grid: cada módulo con layout de dos columnas
(`Study`, `Code`, `Documents`) usa CSS Grid y lo colapsa a una columna con
un único breakpoint:

```css
.study-panel { display: grid; grid-template-columns: 340px 1fr; }

@media (max-width: 860px) {
  .study-panel { grid-template-columns: 1fr; }
}
```

El layout general (`Layout.css`) tiene su propio breakpoint a `860px` que
reorganiza el sidebar de columna vertical (escritorio) a barra horizontal
inferior con solo iconos (móvil) — igual que una app nativa con tab bar.

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
