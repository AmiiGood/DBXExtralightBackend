const fs = require("fs/promises");
const cron = require("node-cron");
const db = require("../config/database");
const osticket = require("../config/osticket");
const { rutaAbsoluta } = require("./comprasArchivos.service");
const avisos = require("./avisosCompras.service");

/**
 * Convierte las solicitudes aprobadas en tickets del osTicket de Compras.
 *
 * Por la API (POST tickets.json con X-API-Key), nunca escribiendo en su base:
 * desde DBX la base de osTicket solo se LEE, y aquí solo para dos consultas
 * baratas (buscar el ticket por número y por folio, ambas filtrando por
 * `created`, que sí tiene índice).
 *
 * Variables de entorno:
 *   OSTICKET_COMPRAS_API_URL  p. ej. http://172.16.101.107/osticketadm/upload/api/http.php/tickets.json
 *                             (con http.php funciona aunque Apache no tenga mod_rewrite)
 *   OSTICKET_COMPRAS_API_KEY  la llave creada en el panel de osTicket, amarrada
 *                             a la IP del servidor de DBX
 *
 * Sin esas dos variables no se intenta nada: las aprobadas esperan.
 *
 * Cuándo se manda:
 *   - en cuanto se aprueba (en segundo plano, la respuesta al gerente no espera)
 *   - y cada 5 min se reintentan las que no llegaron, hasta MAX_INTENTOS.
 *     Pasado eso necesita que alguien dé "Reintentar" en Aprobadores.
 */

const BASE_OSTICKET = "osticketadm";
const MAX_INTENTOS = 10;
const TIEMPO_ESPERA_MS = 90_000;

const url = () => (process.env.OSTICKET_COMPRAS_API_URL || "").trim();
const llave = () => (process.env.OSTICKET_COMPRAS_API_KEY || "").trim();
const configurado = () => Boolean(url() && llave());

const escapar = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const parrafos = (s) => escapar(s).replace(/\r?\n/g, "<br />");

/** Data URI en base64: osTicket hace urldecode si no lo es, y un "+" se volvería espacio. */
const dataUri = (mime, buffer) => `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;

const COMO = { GERENTE: "gerente", SUPLENTE: "suplente", PROPIA: "la pidió el gerente del área" };

/** Lo que va en el asunto. El folio al final es lo que permite encontrarlo después. */
const asuntoTicket = (sol) => `${sol.asunto} [${sol.folio}]`;

/**
 * El cuerpo del ticket: lo que escribió el solicitante, y debajo, quién lo
 * autorizó. Compras ve la aprobación sin salir de osTicket.
 */
function cuerpoTicket(sol) {
  const aprobacion = [
    `<b>Aprobada en DBX Extralight</b> por ${escapar(sol.aprobador)}` +
      (sol.como ? ` (${escapar(COMO[sol.como] || sol.como)})` : "") +
      ` el ${escapar(sol.decidido_texto)}.`,
    `Folio ${escapar(sol.folio)} · Área ${escapar(sol.area)}`,
  ];
  if (sol.comentario) aprobacion.push(`Comentario: ${parrafos(sol.comentario)}`);

  return `<p>${parrafos(sol.detalle)}</p><hr /><p>${aprobacion.join("<br />")}</p>`;
}

/** ¿Ya existe en osTicket? Para no duplicar cuando la respuesta se perdió. */
async function buscarTicketPorFolio(sol) {
  const filas = await osticket.query(
    `SELECT t.ticket_id, t.number
       FROM ${BASE_OSTICKET}.ost_ticket t
       JOIN ${BASE_OSTICKET}.ost_ticket__cdata c ON c.ticket_id = t.ticket_id
      WHERE t.created >= ?
        AND t.topic_id = ?
        AND c.subject LIKE ?
      ORDER BY t.ticket_id
      LIMIT 1`,
    [sol.desde_texto, sol.osticket_topic_id, `%[${sol.folio}]`],
  );
  return filas[0] || null;
}

/** El id interno a partir del número que devuelve la API. Si falla, no importa. */
async function idDelTicket(numero, desde) {
  try {
    const filas = await osticket.query(
      `SELECT ticket_id FROM ${BASE_OSTICKET}.ost_ticket WHERE created >= ? AND number = ? LIMIT 1`,
      [desde, numero],
    );
    return filas[0]?.ticket_id ?? null;
  } catch {
    return null;
  }
}

/**
 * ¿El correo ya es usuario del osTicket de Compras? Si no, osTicket crea uno
 * nuevo con ese correo, y si está mal escrito Compras le contesta a nadie.
 * Devuelve null si no se pudo consultar (no debe bloquear nada).
 */
async function correoEnOsticket(email) {
  if (!email || !osticket.configurado()) return null;
  try {
    const filas = await osticket.query(
      `SELECT 1 FROM ${BASE_OSTICKET}.ost_user_email WHERE address = ? LIMIT 1`,
      [email.trim()],
    );
    return filas.length > 0;
  } catch {
    return null;
  }
}

async function evento(solicitudId, tipo, detalle) {
  await db.query(
    `INSERT INTO compras_solicitud_eventos (solicitud_id, tipo, detalle) VALUES ($1, $2, $3)`,
    [solicitudId, tipo, detalle],
  );
}

async function marcarEnviada(id, { numero, ticketId }, encontrada = false) {
  await db.query(
    `UPDATE compras_solicitudes
        SET estado = 'EN_COMPRAS', osticket_numero = $2, osticket_ticket_id = $3,
            enviado_en = now(), enviando_desde = NULL, ultimo_error_envio = NULL
      WHERE id = $1`,
    [id, numero, ticketId],
  );
  await evento(
    id,
    "ENVIADA",
    encontrada ? `${numero} (ya estaba en osTicket; no se mandó otro)` : numero,
  );
  // A quien pidió, con el número del ticket
  avisos.enSegundoPlano(avisos.avisarEnCompras, id);
}

async function marcarError(id, mensaje, anterior) {
  await db.query(
    `UPDATE compras_solicitudes SET ultimo_error_envio = $2, enviando_desde = NULL WHERE id = $1`,
    [id, mensaje],
  );
  // Un error que se repite en cada reintento no se vuelve a anotar
  if (mensaje !== anterior) await evento(id, "ERROR_ENVIO", mensaje);
}

/**
 * Manda una solicitud aprobada a osTicket.
 *
 * @param {Number}  id
 * @param {Boolean} forzar  ignora el tope de intentos (botón "Reintentar")
 * @returns {{ok, omitido?, motivo?, numero?, error?}}
 */
async function enviar(id, { forzar = false } = {}) {
  if (!configurado()) return { ok: false, omitido: true, motivo: "sin configurar" };

  // Candado: si otro proceso la tiene, o ya no está aprobada, no se toca
  const { rows: tomadas } = await db.query(
    `UPDATE compras_solicitudes
        SET enviando_desde = now(), intentos_envio = intentos_envio + 1
      WHERE id = $1
        AND estado = 'APROBADA'
        AND (enviando_desde IS NULL OR enviando_desde < now() - interval '10 minutes')
        AND ($2 OR intentos_envio < $3)
      RETURNING intentos_envio, ultimo_error_envio`,
    [id, forzar, MAX_INTENTOS],
  );
  if (!tomadas[0]) return { ok: false, omitido: true, motivo: "no disponible" };
  const { intentos_envio: intento, ultimo_error_envio: errorAnterior } = tomadas[0];

  try {
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.detalle, s.comentario,
              to_char(s.decidido_en, 'DD/MM/YYYY HH24:MI') AS decidido_texto,
              -- Margen por si los relojes de los dos servidores no coinciden
              to_char(s.decidido_en - interval '30 minutes', 'YYYY-MM-DD HH24:MI:SS') AS desde_texto,
              ca.nombre AS area, ca.osticket_topic_id,
              us.nombre_completo AS solicitante, us.email,
              ud.nombre_completo AS aprobador,
              (SELECT e.como FROM compras_solicitud_eventos e
                WHERE e.solicitud_id = s.id AND e.tipo = 'APROBADA'
                ORDER BY e.id DESC LIMIT 1) AS como
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN usuarios ud ON ud.id = s.decidido_por
        WHERE s.id = $1`,
      [id],
    );
    const sol = rows[0];

    if (!sol.email) throw new Error(`${sol.solicitante} no tiene correo en DBX`);

    // Si ya hubo un intento, pudo haber llegado sin que nos enteráramos
    if (intento > 1) {
      const existente = await buscarTicketPorFolio(sol);
      if (existente) {
        await marcarEnviada(id, { numero: existente.number, ticketId: existente.ticket_id }, true);
        return { ok: true, numero: existente.number, encontrada: true };
      }
    }

    const { rows: archivos } = await db.query(
      `SELECT nombre_original, ruta, tipo_mime FROM compras_solicitud_archivos
        WHERE solicitud_id = $1 ORDER BY id`,
      [id],
    );
    const adjuntos = [];
    for (const a of archivos) {
      const contenido = await fs.readFile(rutaAbsoluta(a.ruta));
      adjuntos.push({ [a.nombre_original]: dataUri(a.tipo_mime, contenido) });
    }

    const respuesta = await fetch(url(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": llave() },
      body: JSON.stringify({
        alert: true, // el aviso de ticket nuevo a Compras, como siempre
        autorespond: false, // a quien pidió ya le avisa DBX
        source: "API",
        name: sol.solicitante,
        email: sol.email,
        subject: asuntoTicket(sol).slice(0, 255),
        message: dataUri("text/html;charset=utf-8", Buffer.from(cuerpoTicket(sol), "utf8")),
        topicId: sol.osticket_topic_id,
        attachments: adjuntos,
      }),
      signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
    });
    const texto = (await respuesta.text()).trim();

    if (respuesta.status !== 201) {
      throw new Error(`osTicket respondió ${respuesta.status}: ${texto.slice(0, 300) || "(sin mensaje)"}`);
    }
    // La API contesta con el número del ticket y nada más
    if (!texto || texto.length > 32 || /\s/.test(texto)) {
      throw new Error(`osTicket respondió 201 pero no un número de ticket: ${texto.slice(0, 100)}`);
    }

    const ticketId = await idDelTicket(texto, sol.desde_texto);
    await marcarEnviada(id, { numero: texto, ticketId });
    return { ok: true, numero: texto };
  } catch (error) {
    const mensaje =
      error.name === "TimeoutError"
        ? `osTicket no respondió en ${TIEMPO_ESPERA_MS / 1000} s`
        : error.cause?.code
          ? `No se pudo conectar con osTicket (${error.cause.code})`
          : error.message;
    await marcarError(id, mensaje, errorAnterior);
    return { ok: false, error: mensaje };
  }
}

/** Disparo tras aprobar: no hace esperar a quien aprobó y nunca truena. */
function enviarEnSegundoPlano(id) {
  if (!configurado()) return;
  setImmediate(() =>
    enviar(id).catch((e) => console.error(`⚠️  Compras: envío de la solicitud ${id} falló:`, e.message)),
  );
}

/** Reintenta lo aprobado que no ha llegado, lo más viejo primero. */
async function reintentarPendientes() {
  if (!configurado()) return { revisadas: 0 };
  const { rows } = await db.query(
    `SELECT id FROM compras_solicitudes
      WHERE estado = 'APROBADA' AND intentos_envio < $1
      ORDER BY decidido_en
      LIMIT 20`,
    [MAX_INTENTOS],
  );
  let enviadas = 0;
  for (const { id } of rows) {
    const r = await enviar(id);
    if (r.ok) enviadas++;
  }
  return { revisadas: rows.length, enviadas };
}

let tarea = null;

function iniciarProgramado() {
  if (!configurado()) {
    console.log("🕒 Compras: sin OSTICKET_COMPRAS_API_URL/KEY, las aprobadas no se mandan a osTicket");
    return;
  }
  tarea?.stop();
  tarea = cron.schedule("*/5 * * * *", () =>
    reintentarPendientes().catch((e) => console.error("⚠️  Compras: reintento falló:", e.message)),
  );
  console.log("🕒 Compras: reintento de envíos a osTicket cada 5 min");
}

/** Para la pantalla: a dónde apunta, sin enseñar la llave. */
function estadoConexion() {
  let destino = null;
  try {
    destino = url() ? new URL(url()).host + new URL(url()).pathname : null;
  } catch {
    destino = "(URL inválida)";
  }
  return { configurada: configurado(), destino, maxIntentos: MAX_INTENTOS };
}

module.exports = {
  enviar,
  enviarEnSegundoPlano,
  reintentarPendientes,
  iniciarProgramado,
  estadoConexion,
  correoEnOsticket,
  configurado,
  MAX_INTENTOS,
  // para pruebas
  cuerpoTicket,
  asuntoTicket,
};
