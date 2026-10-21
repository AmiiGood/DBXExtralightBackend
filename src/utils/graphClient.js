/**
 * Cliente mínimo de Microsoft Graph para leer archivos de SharePoint.
 *
 * Entra como APLICACIÓN (client credentials), no como una persona: la app se
 * registra en el Entra ID de Finproject con el permiso `Sites.Selected` y TI le
 * concede lectura solo a los sitios que hacen falta. Así el acceso no depende
 * de la contraseña de nadie ni de que alguien tenga la sesión abierta.
 *
 * Los pasos de alta están en DESPLIEGUE_SHAREPOINT.md.
 *
 * Variables del .env:
 *   SP_TENANT_ID      id del directorio (tenant) de Finproject
 *   SP_CLIENT_ID      id de la aplicación registrada
 *   SP_CLIENT_SECRET  secreto de la aplicación
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Un error de Graph con el status HTTP a la mano para poder explicarlo. */
class GraphError extends Error {
  constructor(mensaje, status, codigo) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

function configurado() {
  return Boolean(
    process.env.SP_TENANT_ID && process.env.SP_CLIENT_ID && process.env.SP_CLIENT_SECRET,
  );
}

let token = null;
let venceEn = 0;

/** Token de la aplicación. Se reutiliza hasta un minuto antes de que venza. */
async function obtenerToken() {
  if (token && Date.now() < venceEn) return token;

  if (!configurado()) {
    throw new GraphError(
      "Falta configurar el acceso a SharePoint: SP_TENANT_ID, SP_CLIENT_ID y " +
        "SP_CLIENT_SECRET en el .env del backend.",
      0,
      "SIN_CONFIGURAR",
    );
  }

  const r = await fetch(
    `https://login.microsoftonline.com/${process.env.SP_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SP_CLIENT_ID,
        client_secret: process.env.SP_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  const cuerpo = await r.json().catch(() => ({}));

  if (!r.ok) {
    // AADSTS7000215 = secreto inválido, AADSTS7000222 = secreto vencido,
    // AADSTS700016 = la app no existe en ese tenant. Se deja el código a la
    // vista porque es lo que TI va a buscar.
    const detalle = (cuerpo.error_description || "").split("\r\n")[0];
    throw new GraphError(
      `Microsoft rechazó las credenciales de la aplicación: ${detalle || r.status}`,
      r.status,
      cuerpo.error || "TOKEN",
    );
  }

  token = cuerpo.access_token;
  venceEn = Date.now() + (Number(cuerpo.expires_in || 3600) - 60) * 1000;
  return token;
}

/**
 * GET a Graph. Acepta una ruta relativa (`/sites/...`) o una URL completa
 * (los `@odata.nextLink` de la paginación).
 *
 * @param {Object} opciones { crudo: true } devuelve la respuesta sin leerla
 */
async function get(ruta, opciones = {}) {
  const url = ruta.startsWith("https://") ? ruta : GRAPH + ruta;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${await obtenerToken()}` },
  });

  if (r.status === 401) token = null;

  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new GraphError(
      cuerpo.error?.message || `Graph respondió ${r.status}`,
      r.status,
      cuerpo.error?.code,
    );
  }
  return opciones.crudo ? r : r.json();
}

/**
 * Baja el contenido de un archivo a memoria.
 *
 * `/content` contesta con una redirección a una URL ya firmada; fetch la sigue
 * solo y quita el encabezado de autorización al cambiar de dominio, que es
 * justo lo que esa URL espera.
 */
async function descargar(driveId, itemId) {
  const r = await get(`/drives/${driveId}/items/${itemId}/content`, { crudo: true });
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { get, descargar, configurado, GraphError };
