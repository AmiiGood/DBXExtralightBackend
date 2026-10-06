const cron = require("node-cron");
const db = require("../config/database");
const correo = require("./correo.service");

/**
 * Correos del módulo de Solicitudes de Compra.
 *
 * Ver migrations/2026-10-02_compras_solicitudes_03_avisos.sql para qué correo
 * sale cuándo. Reglas comunes:
 *
 *   - Nunca truenan: un correo que no sale no debe impedir aprobar ni pedir.
 *     El fallo queda en compras_correos.
 *   - Un correo por destinatario, no uno con todos en copia: cada quien ve solo
 *     lo suyo y la bitácora dice exactamente a quién le llegó qué.
 *   - Los enlaces apuntan a APP_URL (la dirección del frontend). Sin ella se
 *     usa CORS_ORIGIN, que en este proyecto es la misma.
 *
 * Los recordatorios usan node-cron con la zona de planta: el servidor de la BD
 * está en GMT y no se sabe en qué zona esté el del backend.
 */

const ZONA = "America/Mexico_City";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const urlApp = () =>
  (process.env.APP_URL || process.env.CORS_ORIGIN || "http://localhost:5173").replace(/\/+$/, "");

const enlace = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return `${urlApp()}/compras/solicitudes${q ? `?${q}` : ""}`;
};

const escapar = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const parrafos = (s) => escapar(s).replace(/\r?\n/g, "<br />");

const recortar = (s, n) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}…` : s || "");

/** "3 h", "2 días": cuánto lleva esperando. */
function espera(horas) {
  const h = Number(horas);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `${d} día${d === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Plantilla
// ---------------------------------------------------------------------------

/** Mismo estilo que los reportes programados: sin imágenes ni CSS externo. */
function plantilla({ titulo, subtitulo, cuerpo, boton }) {
  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#111827;max-width:640px">
    <h2 style="color:#236093;margin:0 0 4px">${titulo}</h2>
    ${subtitulo ? `<p style="color:#6b7280;margin:0 0 16px">${subtitulo}</p>` : ""}
    ${cuerpo}
    ${
      boton
        ? `<p style="margin:20px 0">
             <a href="${escapar(boton.url)}"
                style="background:#236093;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">
               ${boton.texto}</a>
           </p>`
        : ""
    }
    <p style="color:#9ca3af;font-size:11px;margin-top:18px;border-top:1px solid #eee;padding-top:10px">
      Enviado automáticamente por DBX Extralight · Solicitudes de Compra. No respondas a este correo.
    </p>
  </div>`;
}

/** Ficha de una solicitud: lo que hace falta para decidir sin abrir nada más. */
function ficha(s) {
  const fila = (etiqueta, valor) => `
    <tr>
      <td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${etiqueta}</td>
      <td style="padding:4px 0">${valor}</td>
    </tr>`;
  return `
    <table style="border-collapse:collapse;font-size:14px;margin:8px 0">
      ${fila("Folio", `<b>${escapar(s.folio)}</b>`)}
      ${fila("Asunto", escapar(s.asunto))}
      ${fila("Pidió", escapar(s.solicitante))}
      ${fila("Área", escapar(s.area))}
      ${s.archivos ? fila("Archivos", `${s.archivos} adjunto${s.archivos === 1 ? "" : "s"}`) : ""}
    </table>
    <div style="background:#f9fafb;border-radius:6px;padding:10px 12px;font-size:14px">
      ${parrafos(recortar(s.detalle, 800))}
    </div>`;
}

// ---------------------------------------------------------------------------
// Envío y bitácora
// ---------------------------------------------------------------------------

async function mandar({ tipo, solicitudId = null, usuario, asunto, html, texto }) {
  if (!usuario?.email) {
    await bitacora({ tipo, solicitudId, usuario, para: "(sin correo)", asunto, ok: false, error: "El usuario no tiene correo en DBX" });
    return { ok: false };
  }
  try {
    const r = await correo.enviar({ para: [usuario.email], asunto, html, texto });
    const rechazado = r.rechazados?.length > 0;
    await bitacora({
      tipo,
      solicitudId,
      usuario,
      para: usuario.email,
      asunto,
      ok: !rechazado,
      error: rechazado ? `El servidor rechazó: ${r.rechazados.join(", ")}` : null,
      modo: r.modo,
    });
    return { ok: !rechazado, vistaPrevia: r.vistaPrevia };
  } catch (error) {
    await bitacora({ tipo, solicitudId, usuario, para: usuario.email, asunto, ok: false, error: error.message });
    return { ok: false, error: error.message };
  }
}

async function bitacora({ tipo, solicitudId, usuario, para, asunto, ok, error = null, modo = null }) {
  try {
    await db.query(
      `INSERT INTO compras_correos (tipo, solicitud_id, usuario_id, para, asunto, ok, error, modo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tipo, solicitudId, usuario?.id ?? null, para, asunto, ok, error, modo],
    );
  } catch (e) {
    console.error("⚠️  Compras: no se pudo anotar el correo:", e.message);
  }
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

async function leerConfig() {
  const { rows } = await db.query(
    `SELECT avisos_activos, aviso_inmediato, recordatorio_horas, recordatorio_dias,
            to_char(actualizado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS actualizado_en
       FROM compras_config WHERE id = 1`,
  );
  return rows[0];
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function guardarConfig(cambios, usuarioId) {
  const actual = await leerConfig();
  const horas = cambios.recordatorioHoras ?? actual.recordatorio_horas;
  const dias = cambios.recordatorioDias ?? actual.recordatorio_dias;

  if (!Array.isArray(horas) || horas.some((h) => !HORA.test(h))) {
    throw new Error("Las horas van como HH:MM, por ejemplo 09:00");
  }
  if (horas.length > 6) throw new Error("Máximo 6 recordatorios al día");
  if (!Array.isArray(dias) || dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error("Días inválidos");
  }

  await db.query(
    `UPDATE compras_config
        SET avisos_activos = $1, aviso_inmediato = $2,
            recordatorio_horas = $3, recordatorio_dias = $4,
            actualizado_en = now(), actualizado_por = $5
      WHERE id = 1`,
    [
      cambios.avisosActivos ?? actual.avisos_activos,
      cambios.avisoInmediato ?? actual.aviso_inmediato,
      [...new Set(horas)].sort(),
      [...new Set(dias)].sort(),
      usuarioId,
    ],
  );
  await programar();
  return leerConfig();
}

/** "lunes a viernes a las 09:00 y 16:00" */
function describirHorario({ recordatorio_horas: horas, recordatorio_dias: dias }) {
  if (!horas.length || !dias.length) return "sin recordatorios";
  const seguidos = dias.length > 2 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const textoDias = seguidos
    ? `${DIAS[dias[0]]} a ${DIAS[dias.at(-1)]}`
    : dias.map((d) => DIAS[d]).join(", ");
  const textoHoras = horas.length === 1 ? horas[0] : `${horas.slice(0, -1).join(", ")} y ${horas.at(-1)}`;
  return `${textoDias} a las ${textoHoras}`;
}

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

async function datosSolicitud(id) {
  const { rows } = await db.query(
    `SELECT s.id, s.folio, s.asunto, s.detalle, s.estado, s.comentario, s.osticket_numero,
            s.solicitante_id, s.decidido_por, ca.gerente_id, ca.suplente_id,
            ca.nombre AS area,
            us.nombre_completo AS solicitante, us.email AS solicitante_email, us.activo AS solicitante_activo,
            ud.nombre_completo AS decidio,
            (SELECT count(*)::int FROM compras_solicitud_archivos f WHERE f.solicitud_id = s.id) AS archivos
       FROM compras_solicitudes s
       JOIN compras_areas ca ON ca.id = s.compras_area_id
       JOIN usuarios us ON us.id = s.solicitante_id
       LEFT JOIN usuarios ud ON ud.id = s.decidido_por
      WHERE s.id = $1`,
    [id],
  );
  return rows[0];
}

const solicitanteDe = (s) =>
  s.solicitante_activo ? { id: s.solicitante_id, email: s.solicitante_email } : null;

/** ¿Hay que mandar? Solo lee la configuración; si falla, mejor no mandar. */
async function avisosEncendidos(inmediato = false) {
  const c = await leerConfig();
  return c.avisos_activos && (!inmediato || c.aviso_inmediato);
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

/** Al gerente y al suplente, en cuanto llega una solicitud pendiente. */
async function avisarNueva(id) {
  if (!(await avisosEncendidos(true))) return;
  const s = await datosSolicitud(id);
  if (s.estado !== "PENDIENTE") return;

  const { rows: aprobadores } = await db.query(
    `SELECT id, email, nombre_completo FROM usuarios
      WHERE id = ANY($1) AND activo AND id <> $2`,
    [[s.gerente_id, s.suplente_id].filter(Boolean), s.solicitante_id],
  );

  for (const u of aprobadores) {
    await mandar({
      tipo: "NUEVA",
      solicitudId: id,
      usuario: u,
      asunto: `Solicitud de compra por aprobar: ${s.folio} · ${recortar(s.asunto, 80)}`,
      html: plantilla({
        titulo: "Tienes una solicitud de compra por aprobar",
        subtitulo: `${escapar(s.solicitante)} la mandó desde ${escapar(s.area)}`,
        cuerpo: ficha(s),
        boton: { texto: "Revisar y decidir", url: enlace({ vista: "pendientes", id }) },
      }),
      texto: `${s.solicitante} pide: ${s.asunto} (${s.folio}). Revísala en ${enlace({ vista: "pendientes", id })}`,
    });
  }
}

/** A quien pidió, cuando se rechaza. */
async function avisarRechazada(id) {
  if (!(await avisosEncendidos())) return;
  const s = await datosSolicitud(id);
  if (s.estado !== "RECHAZADA") return;
  await mandar({
    tipo: "RECHAZADA",
    solicitudId: id,
    usuario: solicitanteDe(s),
    asunto: `Tu solicitud de compra ${s.folio} fue rechazada`,
    html: plantilla({
      titulo: "Tu solicitud de compra fue rechazada",
      subtitulo: `${escapar(s.folio)} · ${escapar(s.asunto)}`,
      cuerpo: `
        <p><b>${escapar(s.decidio)}</b> la rechazó por este motivo:</p>
        <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 12px;font-size:14px">
          ${parrafos(s.comentario)}
        </div>
        <p style="font-size:14px;color:#6b7280">Si lo necesitas, puedes hacer una solicitud nueva con los ajustes.</p>`,
      boton: { texto: "Ver la solicitud", url: enlace({ id }) },
    }),
    texto: `${s.decidio} rechazó ${s.folio}: ${s.comentario}`,
  });
}

/**
 * A quien pidió, cuando se aprueba y NO hay conexión con osTicket (si la hay,
 * avisa avisarEnCompras con el número del ticket).
 */
async function avisarAprobada(id) {
  if (!(await avisosEncendidos())) return;
  const s = await datosSolicitud(id);
  if (s.estado !== "APROBADA") return;
  await mandar({
    tipo: "APROBADA",
    solicitudId: id,
    usuario: solicitanteDe(s),
    asunto: `Tu solicitud de compra ${s.folio} fue aprobada`,
    html: plantilla({
      titulo: "Tu solicitud de compra fue aprobada",
      subtitulo: `${escapar(s.folio)} · ${escapar(s.asunto)}`,
      cuerpo: `
        <p>La aprobó <b>${escapar(s.decidio)}</b>.${s.comentario ? ` Comentó: “${parrafos(s.comentario)}”` : ""}</p>
        <p style="font-size:14px;color:#6b7280">Pasará a Compras como ticket; puedes ver en qué va desde DBX.</p>`,
      boton: { texto: "Ver la solicitud", url: enlace({ id }) },
    }),
    texto: `${s.decidio} aprobó ${s.folio}.`,
  });
}

/** A quien pidió, cuando ya existe el ticket en Compras. */
async function avisarEnCompras(id) {
  if (!(await avisosEncendidos())) return;
  const s = await datosSolicitud(id);
  if (s.estado !== "EN_COMPRAS") return;
  const propia = s.decidido_por === s.solicitante_id;
  await mandar({
    tipo: "EN_COMPRAS",
    solicitudId: id,
    usuario: solicitanteDe(s),
    asunto: `Tu solicitud ${s.folio} ya está en Compras (ticket ${s.osticket_numero})`,
    html: plantilla({
      titulo: "Tu solicitud ya está en Compras",
      subtitulo: `${escapar(s.folio)} · ${escapar(s.asunto)}`,
      cuerpo: `
        <p>${
          propia
            ? "Como la pediste siendo gerente del área, pasó directo."
            : `La aprobó <b>${escapar(s.decidio)}</b>.${s.comentario ? ` Comentó: “${parrafos(s.comentario)}”` : ""}`
        }</p>
        <p>Compras la recibió como el ticket <b>${escapar(s.osticket_numero)}</b>. Lo que siga
           (cotización, dudas, entrega) te lo contestará Compras por ese ticket.</p>`,
      boton: { texto: "Ver la solicitud", url: enlace({ id }) },
    }),
    texto: `${s.folio} ya está en Compras como ticket ${s.osticket_numero}.`,
  });
}

/**
 * Un correo por aprobador con todo lo que le espera, de todas sus áreas.
 * Sin pendientes no se manda nada.
 */
async function mandarRecordatorios({ forzar = false } = {}) {
  if (!forzar && !(await avisosEncendidos())) return { aprobadores: 0, enviados: 0 };

  const { rows } = await db.query(
    `SELECT u.id AS aprobador_id, u.email, u.nombre_completo AS aprobador,
            s.id, s.folio, s.asunto, ca.nombre AS area,
            us.nombre_completo AS solicitante,
            to_char(s.creado_en, 'DD/MM HH24:MI') AS creado_texto,
            EXTRACT(EPOCH FROM (now() - s.creado_en)) / 3600.0 AS horas
       FROM compras_solicitudes s
       JOIN compras_areas ca ON ca.id = s.compras_area_id
       JOIN usuarios us ON us.id = s.solicitante_id
       JOIN usuarios u ON u.id IN (ca.gerente_id, ca.suplente_id) AND u.activo
      WHERE s.estado = 'PENDIENTE'
        AND ca.activo
        AND u.id <> s.solicitante_id
      ORDER BY u.id, s.creado_en`,
  );

  const porAprobador = new Map();
  for (const r of rows) {
    if (!porAprobador.has(r.aprobador_id)) {
      porAprobador.set(r.aprobador_id, { usuario: { id: r.aprobador_id, email: r.email }, lista: [] });
    }
    porAprobador.get(r.aprobador_id).lista.push(r);
  }

  let enviados = 0;
  for (const { usuario, lista } of porAprobador.values()) {
    const n = lista.length;
    const variasAreas = new Set(lista.map((s) => s.area)).size > 1;
    const filas = lista
      .map(
        (s) => `
        <tr>
          <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;white-space:nowrap">
            <a href="${escapar(enlace({ vista: "pendientes", id: s.id }))}" style="color:#236093">${escapar(s.folio)}</a></td>
          <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${escapar(recortar(s.asunto, 70))}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${escapar(s.solicitante)}${
            variasAreas ? `<br /><span style="color:#9ca3af;font-size:12px">${escapar(s.area)}</span>` : ""
          }</td>
          <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;color:${
            s.horas >= 24 ? "#b45309" : "#6b7280"
          }">${espera(s.horas)}</td>
        </tr>`,
      )
      .join("");

    const r = await mandar({
      tipo: "RECORDATORIO",
      usuario,
      asunto: `Tienes ${n} solicitud${n === 1 ? "" : "es"} de compra por aprobar`,
      html: plantilla({
        titulo: `${n} solicitud${n === 1 ? "" : "es"} de compra esperan tu aprobación`,
        subtitulo: "Hasta que decidas, Compras no las recibe.",
        cuerpo: `
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead>
              <tr style="background:#236093;color:#fff">
                <th style="padding:8px 10px;text-align:left">Folio</th>
                <th style="padding:8px 10px;text-align:left">Asunto</th>
                <th style="padding:8px 10px;text-align:left">Pidió</th>
                <th style="padding:8px 10px;text-align:right">Esperando</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>`,
        boton: { texto: "Ir a mi bandeja", url: enlace({ vista: "pendientes" }) },
      }),
      texto: `Tienes ${n} solicitud(es) de compra por aprobar: ${enlace({ vista: "pendientes" })}`,
    });
    if (r.ok) enviados++;
  }
  return { aprobadores: porAprobador.size, enviados };
}

/** Correo de prueba al usuario que lo pide, para validar el SMTP. */
async function mandarPrueba(usuario) {
  return mandar({
    tipo: "PRUEBA",
    usuario,
    asunto: "Prueba de avisos · Solicitudes de Compra",
    html: plantilla({
      titulo: "Los avisos de Compras te llegan bien",
      subtitulo: "Correo de prueba",
      cuerpo: `<p>Si estás leyendo esto, el servidor de DBX puede mandar correos a <b>${escapar(
        usuario.email,
      )}</b>.</p>`,
      boton: { texto: "Abrir Solicitudes de Compra", url: enlace() },
    }),
    texto: "Correo de prueba de DBX Extralight.",
  });
}

/** Lo último que se mandó, para la pantalla. */
async function ultimosCorreos(limite = 30) {
  const { rows } = await db.query(
    `SELECT c.id, c.tipo, c.para, c.asunto, c.ok, c.error, c.modo,
            to_char(c.enviado_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS enviado_en,
            s.folio
       FROM compras_correos c
       LEFT JOIN compras_solicitudes s ON s.id = c.solicitud_id
      ORDER BY c.enviado_en DESC, c.id DESC
      LIMIT $1`,
    [limite],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Programación de recordatorios
// ---------------------------------------------------------------------------

let tareas = [];

async function programar() {
  for (const t of tareas) t.stop();
  tareas = [];

  const c = await leerConfig();
  if (!c.avisos_activos || !c.recordatorio_horas.length || !c.recordatorio_dias.length) {
    console.log("🕒 Compras: recordatorios apagados");
    return;
  }
  for (const hora of c.recordatorio_horas) {
    const [h, m] = hora.split(":").map(Number);
    const expresion = `${m} ${h} * * ${c.recordatorio_dias.join(",")}`;
    tareas.push(
      cron.schedule(
        expresion,
        () =>
          mandarRecordatorios().catch((e) =>
            console.error("⚠️  Compras: recordatorio falló:", e.message),
          ),
        { timezone: ZONA },
      ),
    );
  }
  console.log(`🕒 Compras: recordatorios ${describirHorario(c)}`);
}

function iniciarProgramado() {
  programar().catch((e) => console.error("⚠️  Compras: no se programaron los recordatorios:", e.message));
}

/** Para disparar desde otros módulos sin hacerlos esperar ni tronar. */
function enSegundoPlano(fn, id) {
  setImmediate(() =>
    fn(id).catch((e) => console.error(`⚠️  Compras: aviso de la solicitud ${id} falló:`, e.message)),
  );
}

module.exports = {
  avisarNueva,
  avisarRechazada,
  avisarAprobada,
  avisarEnCompras,
  mandarRecordatorios,
  mandarPrueba,
  ultimosCorreos,
  leerConfig,
  guardarConfig,
  describirHorario,
  iniciarProgramado,
  enSegundoPlano,
};
