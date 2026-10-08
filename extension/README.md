# Eddie en tu navegador

Extensión de Chrome (Manifest V3) que deja a Eddie abrir pestañas en tu navegador: tus reuniones del calendario a su hora, los
documentos que crea y los enlaces que le pidas.

## Instalar

1. Extrae el zip (en el Chromebook: clic derecho → **Extraer todo**). Debe quedar una carpeta con `manifest.json` dentro.
2. Abre `chrome://extensions`, activa **Modo de desarrollador** y pulsa **Cargar descomprimida**; elige la **carpeta que contiene `manifest.json`** (un clic sobre ella y **Abrir**; no son archivos). Si dice «Falta el archivo de manifiesto», elegiste una carpeta de más o de menos.
3. En Eddie: **Conectores → Tu navegador → Vincular este navegador**.

## Qué hace y qué no

- Pide solo `alarms` (para abrir cada reunión a su hora) y `storage` (guarda su clave y lo que ya abrió).
- **Solo abre pestañas.** No lee páginas, ni las direcciones de tus pestañas, ni lo que escribes.
- Cada 30 s pregunta a Eddie si hay páginas por abrir; cada 10 min, qué reuniones tienes. La página de Eddie le habla directo
  cuando está abierta (al instante).
- Solo abre direcciones `https` públicas (`urls.js`; el servidor aplica la misma regla en `api/_lib/browser/urls.js`).

## Archivos

| Archivo | Para qué |
|---|---|
| `manifest.json` | Permisos, direcciones de Eddie que le pueden hablar y la clave que fija su id (`amdcngcajoekfaljieikbgifmhoigdfb`). |
| `background.js` | Sondeo, alarmas de reuniones, apertura de pestañas, vínculo con Eddie. |
| `urls.js` | Qué direcciones se abren. |
| `popup.html`, `popup.js` | La ventana del ícono: estado y vínculo manual con código. |

## Otra dirección de Eddie / desarrollo local

Cambia `host_permissions` y `externally_connectable` en `manifest.json` (por ejemplo `http://localhost/*` para `npm run dev`) y
recarga la extensión. Sin eso, Chrome ignora los mensajes de esa página.
