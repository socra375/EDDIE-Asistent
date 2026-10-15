# Eddie en tu navegador

Extensión de Chrome (Manifest V3) que deja a Eddie abrir pestañas en tu navegador: tus reuniones del calendario a su hora, los
documentos que crea y los enlaces que le pidas.

## Instalar

1. Extrae el zip (en el Chromebook: clic derecho → **Extraer todo**). Debe quedar una carpeta con `manifest.json` dentro.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar descomprimida**; elige la **carpeta que contiene `manifest.json`** (un clic sobre ella y **Abrir**; no son archivos). Si dice «Falta el archivo de manifiesto», elegiste una carpeta de más o de menos.
3. En Eddie: **Conectores → Tu navegador → Vincular este navegador**.

## Eddie en cualquier web (panel lateral, desde la 1.2.0)

- **Abrir**: tecla **Alt+E** (se cambia en `chrome://extensions/shortcuts`), el botón del ícono de la extensión o clic derecho → «Resumir esta página con Eddie» / «Preguntarle a Eddie sobre «texto seleccionado»».
- Se abre **Eddie al lado de la página** (`sidepanel.html`, que carga `/?panel=1`): el chat solo, con el interruptor **«Usar esta página»**.
- **Leer la página es opcional y empieza apagado**: el botón «Permitir que Eddie lea la página que veo» pide el permiso de Chrome (todas las webs `https`) y lo activa. Con él, solo cuando
  **envías un mensaje** con «Usar esta página» marcado, Eddie recibe **el texto visible de la pestaña que tienes delante** (hasta 12.000 caracteres) y lo que tengas seleccionado: nunca
  el contenido de formularios, **nunca una página con campo de contraseña**, nunca en segundo plano ni de otras pestañas. Va a la IA como contexto de ese mensaje y no se guarda en el historial.
- Si el panel no puede conservar tu sesión (algunos navegadores bloquean las cookies dentro de un marco) o hay que iniciar sesión, el panel lo dice y ofrece **abrir Eddie en una ventana** pequeña o en una pestaña.
- Permisos nuevos: `sidePanel`, `scripting` (leer la pestaña, solo con lo anterior) y `contextMenus` (el clic derecho).

## Las pestañas de Eddie (desde la 1.3.0)

Todo lo que Eddie abre o usa aparece en un **grupo de pestañas de color cian llamado «Eddie»**, para que veas de un vistazo qué pestañas son suyas y las cierres o desagrupes de un clic (clic derecho en el grupo):

- una página que Eddie abre (un documento que creó, un enlace, una reunión);
- la pestaña de una **tarea de navegador**: el grupo dice **«⏳ Eddie»** mientras trabaja y **«✅ Eddie»** cuando termina;
- la página que tienes delante cuando abres **el panel lateral** de Eddie.

Nunca mueve una **pestaña fijada** ni una que **tú ya metiste en un grupo tuyo**. Solo usa la API de pestañas y grupos del navegador (¿está fijada?, ¿en qué grupo y ventana?): no lee la dirección, el título ni el contenido de ninguna página para esto. Permiso nuevo: `tabGroups` (sin avisos de Chrome; al ser una extensión descomprimida se aplica al recargarla).

## Qué hace y qué no

- Pide solo `alarms` (para abrir cada reunión a su hora) y `storage` (guarda su clave y lo que ya abrió).
- **Abre pestañas** y, **solo si lo activas** en el panel lateral, **lee la página que estás viendo cuando le escribes a Eddie** (ver «Eddie en cualquier web»). No lee lo que escribes ni nada en segundo plano.
- Cada 30 s pregunta a Eddie si hay páginas por abrir; cada 10 min, qué reuniones tienes. La página de Eddie le habla directo
  cuando está abierta (al instante).
- Solo abre direcciones `https` públicas (`urls.js`; el servidor aplica la misma regla en `api/_lib/browser/urls.js`).

## Archivos

| Archivo | Para qué |
|---|---|
| `manifest.json` | Permisos, direcciones de Eddie que le pueden hablar y la clave que fija su id (`amdcngcajoekfaljieikbgifmhoigdfb`). |
| `background.js` | Sondeo, alarmas de reuniones, apertura de pestañas, vínculo con Eddie. |
| `urls.js` | Qué direcciones se abren. |
| `group.js` | El grupo de pestañas «Eddie» (qué entra, el título según lo que hace). |
| `popup.html`, `popup.js` | La ventana del ícono: abrir el panel, estado y vínculo manual con código. |
| `sidepanel.html`, `sidepanel.js` | El panel lateral: marco con Eddie (`/?panel=1`) y el intermediario con la extensión. |
| `panel.js` | Atajo, clic derecho y la lectura de la página (con sus límites). |

## Otra dirección de Eddie / desarrollo local

Cambia `host_permissions` y `externally_connectable` en `manifest.json` (por ejemplo `http://localhost/*` para `npm run dev`) y
recarga la extensión. Sin eso, Chrome ignora los mensajes de esa página.
