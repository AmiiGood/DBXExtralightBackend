const cron = require("node-cron");
const db = require("../config/database");
const osticket = require("../config/osticket");

/**
 * Quién tiene asignado cada ticket de Compras en osTicket.
 *
 * El ticket nace asignado al agente del tema (Celia para Mantenimiento, Mónica
 * para RH...) pero se reasigna seguido: desde agosto, la becaria atendió
 * decenas que llegaron a nombre de otros. Por eso el DBX no fija un agente por
 * área: lee el asignado ACTUAL de cada ticket y lo guarda en la solicitud. La
 * bandeja de Cotizaciones cruza ese correo con el del usuario del DBX.
 *
 * Se lee cada 5 minutos y, además, al abrir la bandeja si la última lectura
 * tiene más de un minuto. Son consultas chicas por llave primaria: osTicket
 * atiende a toda la planta y aquí somos invitados.
 *
 * Solo se siguen las solicitudes vivas: en Compras, cotizadas y elegidas de
 * los últimos 30 días (después de elegir, Compras puede seguir moviendo el
 * ticket a "PO colocada").
 */

const BASE = "osticketadm";
const CADA_MINUTOS = 5;
const MINIMO_ENTRE_LECTURAS_MS = 60_000;
const LOTE = 200;

let tarea = null;
let corriendo = null;
let ultimaLectura = 0;

async function actualizar() {
  if (!osticket.configurado()) return { leidas: 0, cambios: 0 };
  const { rows } = await db.query(
    `SELECT id, osticket_ticket_id, asignado_staff_id, osticket_estado
       FROM compras_solicitudes
      WHERE osticket_ticket_id IS NOT NULL
        AND (estado IN ('EN_COMPRAS', 'COTIZADA')
             OR (estado = 'ELEGIDA' AND elegido_en > now() - interval '30 days'))`,
  );
  let cambios = 0;
  for (let i = 0; i < rows.length; i += LOTE) {
    const lote = rows.slice(i, i + LOTE);
    const ids = lote.map((r) => r.osticket_ticket_id);
    const tickets = await osticket.query(
      `SELECT t.ticket_id, t.staff_id, s.firstname, s.lastname, s.email, st.name AS estado
         FROM ${BASE}.ost_ticket t
         LEFT JOIN ${BASE}.ost_staff s ON s.staff_id = t.staff_id
         LEFT JOIN ${BASE}.ost_ticket_status st ON st.id = t.status_id
        WHERE t.ticket_id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    const porId = new Map(tickets.map((t) => [t.ticket_id, t]));
    for (const r of lote) {
      const t = porId.get(r.osticket_ticket_id);
      if (!t) continue;
      const staff = t.staff_id || null;
      const nombre = staff ? `${t.firstname || ""} ${t.lastname || ""}`.replace(/\s+/g, " ").trim() : null;
      const cambio = staff !== r.asignado_staff_id || (t.estado || null) !== r.osticket_estado;
      await db.query(
        `UPDATE compras_solicitudes
            SET asignado_staff_id = $2, asignado_nombre = $3, asignado_email = $4,
                osticket_estado = $5, asignado_leido_en = now()
          WHERE id = $1`,
        [r.id, staff, nombre, staff ? (t.email || "").trim().toLowerCase() || null : null, t.estado || null],
      );
      if (cambio) cambios++;
    }
  }
  ultimaLectura = Date.now();
  return { leidas: rows.length, cambios };
}

/** Lee si hace falta; dos llamadas a la vez esperan la misma lectura. */
function actualizarSiHaceFalta() {
  if (Date.now() - ultimaLectura < MINIMO_ENTRE_LECTURAS_MS) return Promise.resolve(null);
  if (!corriendo) {
    corriendo = actualizar().finally(() => {
      corriendo = null;
    });
  }
  return corriendo;
}

function iniciarProgramado() {
  if (tarea || !osticket.configurado()) return;
  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, () =>
    actualizarSiHaceFalta().catch((e) => console.warn("⚠️  Compras: no se leyeron los asignados —", e.message)),
  );
}

function detenerProgramado() {
  if (!tarea) return;
  tarea.stop();
  tarea = null;
}

module.exports = { actualizar, actualizarSiHaceFalta, iniciarProgramado, detenerProgramado };
