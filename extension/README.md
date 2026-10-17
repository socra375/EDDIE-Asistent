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

## Pestañas a su hora (desde la 1.6.0)

Eddie puede abrir, **cerrar y editar pestañas** a la hora que le digas (`tabs.js`): cierra las de unos sitios (con sus subdominios), las recarga, las lleva a otra página, las fija o silencia. Las órdenes llegan de dos maneras: **ya** (al preguntar al servidor cada 30 s) o **a una hora exacta** (la extensión pide los planes del próximo día y medio cada 10 minutos, pone una alarma por plan y los hace al minuto; después avisa con `plan-done`). Cada orden lleva una clave y se hace una sola vez. Nunca cierra una pestaña fijada, la de Eddie ni la de una tarea de navegador en marcha. Permiso nuevo: `tabs`, para saber de qué sitio es cada pestaña (en tu equipo; no se guarda ni se envía). Un plan atrasado hasta 15 minutos (navegador cerrado a su hora) todavía se hace al abrir; después ya no.

## Páginas de un momento (desde la 1.5.0)

Algunas páginas Eddie las abre solo para que las veas mientras te habla —el correo y la agenda del «buenos días» al encender el PC— y **las cierra él mismo**: cada una llega con los segundos que le quedan (`closeIn`) y, al cumplirse (un temporizador y una alarma de respaldo), `background.js` cierra la pestaña **solo si sigue en el grupo «Eddie» y no está fijada**. Para quedarte con una, arrástrala fuera del grupo. La lista de cierres se vacía al abrir el navegador (los números de pestaña no valen entre sesiones) y un cierre que se atrasó más de 5 minutos se olvida. Las páginas que Eddie abre para quedarse (un documento que creó, una reunión) no traen hora de cierre y nunca se cierran.

## Su mouse y su teclado (desde la 1.4.0)

En una **tarea de navegador** que tú confirmaste (o en una página de confianza), Eddie maneja **esa pestaña** con el mouse y el teclado, un paso a la vez (`actions.js`): clic, doble clic, clic derecho, arrastrar, escribir, teclas (Enter, Tab, Escape, Retroceso, Suprimir, Espacio, flechas, Inicio, Fin, Re Pág, Av Pág, Ctrl+A y Ctrl+Z), desplazar y esperar. Nada más: ni portapapeles, ni recargar, ni cerrar ventanas. Las capturas van como JPEG. La página de Eddie puede pedirle que empiece de inmediato (mensaje `wake`: solo revisa si hay una tarea; no trae datos). Nunca teclea contraseñas, tarjetas ni códigos de seguridad, y se detiene en el botón **Detener** del ícono.

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
| `actions.js` | El mouse y el teclado de una tarea de navegador (qué teclas, cómo se arrastra, cuánto se espera). |
| `tabs.js` | Las órdenes sobre pestañas abiertas (qué pestañas son de un sitio, cerrar, editar). |
| `group.js` | El grupo de pestañas «Eddie» (qué entra, el título según lo que hace, si una pestaña sigue siendo suya). |
| `popup.html`, `popup.js` | La ventana del ícono: abrir el panel, estado y vínculo manual con código. |
| `sidepanel.html`, `sidepanel.js` | El panel lateral: marco con Eddie (`/?panel=1`) y el intermediario con la extensión. |
| `panel.js` | Atajo, clic derecho y la lectura de la página (con sus límites). |

## Otra dirección de Eddie / desarrollo local

Cambia `host_permissions` y `externally_connectable` en `manifest.json` (por ejemplo `http://localhost/*` para `npm run dev`) y
recarga la extensión. Sin eso, Chrome ignora los mensajes de esa página.

## Historial de YouTube (desde la 1.7.0)

Opcional y solo si lo pides: en el popup, «Dar acceso al historial de YouTube» pide el permiso `history` (declarado como *opcional*; sin él, nada se lee). Con él, cada 6 horas envía a Eddie, de las páginas de YouTube que abriste en los últimos 60 días, el id del video, el título y las horas (`history.js`), para que Eddie te ofrezca música a tu hora. Nada más del historial se lee. «Quitar acceso» retira el permiso y borra la copia en Eddie.
