const nodemailer = require("nodemailer");

/**
 * Envío de correo.
 *
 * Tres modos, según lo que haya en el .env:
 *
 *   SMTP_HOST definido  -> se usa ese servidor (Mailpit en local, Microsoft 365
 *                          en producción). Es el modo normal.
 *   sin SMTP_HOST       -> Ethereal: nodemailer crea una cuenta desechable al
 *                          vuelo y devuelve un link para ver el correo. Sirve
 *                          para probar sin instalar nada, pero necesita
 *                          internet y NO entrega a los destinatarios reales.
 *
 * En los dos casos el correo NO sale a buzones de verdad mientras no se apunte
 * a un SMTP real.
 */

let transporteCache = null;
let modoCache = null;

/**
 * Devuelve el transporte, creándolo la primera vez.
 * @returns {{transporte, modo, remitente}}
 */
async function obtenerTransporte() {
  if (transporteCache) {
    return { transporte: transporteCache, modo: modoCache, remitente: remitente() };
  }

  const host = (process.env.SMTP_HOST || "").trim();

  if (host) {
    const puerto = parseInt(process.env.SMTP_PORT || "587", 10);
    const opciones = {
      host,
      port: puerto,
      // 465 es TLS implícito; el resto arranca en claro y sube con STARTTLS
      secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || puerto === 465,
    };
    // Mailpit no pide autenticación: si no hay usuario, no se manda auth
    if (process.env.SMTP_USER) {
      opciones.auth = {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || "",
      };
    }
    transporteCache = nodemailer.createTransport(opciones);
    modoCache = `smtp (${host}:${puerto})`;
  } else {
    const cuenta = await nodemailer.createTestAccount();
    transporteCache = nodemailer.createTransport({
      host: cuenta.smtp.host,
      port: cuenta.smtp.port,
      secure: cuenta.smtp.secure,
      auth: { user: cuenta.user, pass: cuenta.pass },
    });
    modoCache = "ethereal (cuenta de prueba, no entrega de verdad)";
    console.log(`📧 Sin SMTP_HOST: usando Ethereal (${cuenta.user})`);
  }

  return { transporte: transporteCache, modo: modoCache, remitente: remitente() };
}

function remitente() {
  return (
    process.env.SMTP_FROM ||
    "DBX Extralight <no-reply@dbxextralight.local>"
  );
}

/**
 * Comprueba que el servidor de correo responda. Útil para el botón de
 * "probar conexión" antes de programar nada.
 */
async function verificar() {
  const { transporte, modo } = await obtenerTransporte();
  await transporte.verify();
  return { ok: true, modo, remitente: remitente() };
}

/**
 * Envía un correo con adjuntos.
 *
 * @param {Object} opciones
 *   para        Array de correos (ya validados contra una lista)
 *   asunto      String
 *   html        String
 *   texto       String  alternativa en texto plano
 *   adjuntos    [{ filename, content: Buffer, contentType }]
 * @returns {{messageId, modo, vistaPrevia, aceptados, rechazados}}
 */
async function enviar({ para, asunto, html, texto, adjuntos = [] }) {
  if (!Array.isArray(para) || para.length === 0) {
    throw new Error("No hay destinatarios");
  }

  const { transporte, modo, remitente: de } = await obtenerTransporte();

  const info = await transporte.sendMail({
    from: de,
    to: para.join(", "),
    subject: asunto,
    text: texto,
    html,
    attachments: adjuntos,
  });

  return {
    messageId: info.messageId,
    modo,
    // Ethereal devuelve una URL para ver el correo; con SMTP normal es false
    vistaPrevia: nodemailer.getTestMessageUrl(info) || null,
    aceptados: info.accepted || [],
    rechazados: info.rejected || [],
  };
}

/** Fuerza que se reconstruya el transporte (si cambian las variables). */
function reiniciar() {
  transporteCache = null;
  modoCache = null;
}

module.exports = { enviar, verificar, reiniciar, obtenerTransporte };
