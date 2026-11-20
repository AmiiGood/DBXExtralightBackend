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
        <p>Compras la recibió como el ticket <b>${escapar(s.osticket_numero)}</b> y la cotiza.
           Después pasa a firmas como orden de compra; en el DBX puedes ver en qué firma va. Dudas y
           entrega las verás por ese ticket.</p>`,
      boton: { texto: "Ver la solicitud", url: enlace({ id }) },
    }),
    texto: `${s.folio} ya está en Compras como ticket ${s.osticket_numero}.`,
  });
}

// ---------------------------------------------------------------------------
// Compras
// ---------------------------------------------------------------------------

const dinero = (n, moneda) =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

/** A quién de Compras avisarle: quien dio de alta la orden y quien tiene el ticket ahora. */
async function genteDeCompras(solicitudId) {
  const { rows } = await db.query(
    `SELECT s.asignado_email, u.id, u.email
       FROM compras_solicitudes s
       LEFT JOIN compras_ordenes o ON o.solicitud_id = s.id
       LEFT JOIN usuarios u ON u.id = o.enviada_por AND u.activo
      WHERE s.id = $1`,
    [solicitudId],
  );
  const r = rows[0] || {};
  const lista = [];
  if (r.email) lista.push({ id: r.id, email: r.email });
  if (r.asignado_email && !lista.some((u) => u.email.toLowerCase() === r.asignado_email)) {
    lista.push({ id: null, email: r.asignado_email });
  }
  return lista;
}

/**
 * Al gerente y al suplente del área, cuando una elección deja el presupuesto
 * del mes en negativo. No bloquea nada: es para que lo sepan.
 */
async function avisarSobregiro(id) {
  if (!(await avisosEncendidos())) return;
  const s = await datosSolicitud(id);
  if (!["ELEGIDA", "AUTORIZADA"].includes(s.estado)) return;
  const { rows } = await db.query(
    `SELECT s.compras_area_id, s.presupuesto_anio, s.presupuesto_mes, s.monto_presupuesto::float AS monto,
            coalesce(oc.monto, s.monto_elegido)::float AS monto_elegido,
            coalesce(oc.moneda, s.moneda_elegida) AS moneda_elegida,
            coalesce(oc.proveedor, o.proveedor) AS proveedor
       FROM compras_solicitudes s
       LEFT JOIN compras_ordenes oc ON oc.solicitud_id = s.id
       LEFT JOIN compras_cotizacion_opciones o ON o.id = s.opcion_elegida_id
      WHERE s.id = $1`,
    [id],
  );
  const e = rows[0];
  if (!e?.presupuesto_anio || e.monto == null) return;
  const saldo = await require("../models/CompraPresupuesto").saldo(e.compras_area_id, e.presupuesto_anio, e.presupuesto_mes);
  if (!saldo.configurado || saldo.disponibleMes >= 0) return;

  const pesos = (n) => dinero(n, "MXN").replace(" MXN", "");
  const { rows: gerentes } = await db.query(
    `SELECT id, email FROM usuarios WHERE id = ANY($1) AND activo`,
    [[s.gerente_id, s.suplente_id].filter(Boolean)],
  );
  for (const u of gerentes) {
    await mandar({
      tipo: "SOBREGIRO",
      solicitudId: id,
      usuario: u,
      asunto: `Presupuesto de ${s.area} rebasado con ${s.folio}`,
      html: plantilla({
        titulo: `El presupuesto de ${escapar(s.area)} quedó en negativo`,
        subtitulo: `${escapar(s.folio)} · ${escapar(s.asunto)}`,
        cuerpo: `
          <p>${
            s.estado === "AUTORIZADA"
              ? `Se autorizó la orden de compra de <b>${escapar(s.solicitante)}</b> a <b>${escapar(e.proveedor || "un proveedor")}</b>`
              : `<b>${escapar(s.solicitante)}</b> eligió a <b>${escapar(e.proveedor || "un proveedor")}</b>`
          }
             por ${dinero(e.monto_elegido, e.moneda_elegida)}; al presupuesto se le descontaron
             <b>${pesos(e.monto)}</b> (sin IVA, en pesos).</p>
          <table style="border-collapse:collapse;font-size:14px;margin:8px 0">
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Disponible del mes</td>
                <td style="padding:4px 0;color:#b91c1c"><b>${pesos(saldo.disponibleMes)}</b></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Disponible del año</td>
                <td style="padding:4px 0">${pesos(saldo.disponibleAnual)} de ${pesos(saldo.presupuestoAnual)}</td></tr>
          </table>
          <p style="font-size:14px;color:#6b7280">La compra no se detuvo: el DBX solo avisa cuando se rebasa.</p>`,
        boton: { texto: "Ver la solicitud", url: enlace({ id }) },
      }),
      texto: `${s.folio} dejó el presupuesto de ${s.area} en ${pesos(saldo.disponibleMes)} este mes.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Orden de compra
// ---------------------------------------------------------------------------

const enlaceOrdenes = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return `${urlApp()}/compras/ordenes${q ? `?${q}` : ""}`;
};

const PASO_TEXTO = { GERENTE: "el gerente del área", COMPRAS: "Compras", FINANZAS: "Finanzas", DIRECCION: "Dirección" };

async function datosOrden(solicitudId) {
  const { rows } = await db.query(
    `SELECT o.id, o.estado, o.paso, o.proveedor, o.monto::float AS monto, o.moneda, o.incluye_iva,
            o.clasif_tipo, o.cuenta, o.centro_costos, o.motivo_rechazo, o.rechazada_paso,
            ur.nombre_completo AS rechazo
       FROM compras_ordenes o
       LEFT JOIN usuarios ur ON ur.id = o.rechazada_por
      WHERE o.solicitud_id = $1`,
    [solicitudId],
  );
  if (!rows[0]) return null;
  const { rows: firmas } = await db.query(
    `SELECT f.paso, u.nombre_completo AS nombre, to_char(f.firmado_en, 'DD/MM HH24:MI') AS cuando
       FROM compras_orden_firmas f JOIN usuarios u ON u.id = f.usuario_id
      WHERE f.orden_id = $1 ORDER BY f.firmado_en`,
    [rows[0].id],
  );
  return { ...rows[0], firmas };
}

/**
 * Lo que sale en todos los correos de la orden: qué se compra y quién ya firmó.
 * A quien pidió no se le pone proveedor, monto, tipo ni cuenta (18-nov-2026).
 */
function fichaOrden(s, o, { conMontos = true } = {}) {
  const fila = (etiqueta, valor) => `
    <tr>
      <td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${etiqueta}</td>
      <td style="padding:4px 0">${valor}</td>
    </tr>`;
  return `
    <table style="border-collapse:collapse;font-size:14px;margin:8px 0">
      ${fila("Folio", `<b>${escapar(s.folio)}</b> · ticket ${escapar(s.osticket_numero)}`)}
      ${fila("Asunto", escapar(s.asunto))}
      ${fila("Pidió", `${escapar(s.solicitante)} · ${escapar(s.area)}`)}
      ${conMontos ? fila("Proveedor", `<b>${escapar(o.proveedor)}</b>`) : ""}
      ${conMontos ? fila("Monto", `<b>${dinero(o.monto, o.moneda)}</b> ${o.incluye_iva ? "con IVA" : "sin IVA"}`) : ""}
      ${conMontos && o.clasif_tipo ? fila("Tipo", escapar(o.clasif_tipo)) : ""}
      ${conMontos && o.cuenta ? fila("Cuenta", `${escapar(o.cuenta)}${o.centro_costos ? ` · CC ${escapar(o.centro_costos)}` : ""}`) : ""}
      ${
        o.firmas.length
          ? fila("Firmas", o.firmas.map((f) => `${escapar(f.nombre)} (${PASO_TEXTO[f.paso]}, ${f.cuando})`).join("<br />"))
          : ""
      }
    </table>`;
}

/**
 * Después de enviar, firmar o rechazar una orden: a quien le toca firmar, o a
 * quien pidió y a Compras cuando termina (autorizada o rechazada).
 */
/**
 * Quiénes pueden firmar el paso en que va una orden: el gerente (aunque la haya
 * pedido él) y el suplente que no la pidió; en los demás pasos, la lista de
 * firmantes menos quien la pidió.
 */
async function firmantesDe(s, o) {
  const { rows } =
    o.paso === "GERENTE"
      ? await db.query(`SELECT id, email FROM usuarios WHERE activo AND (id = $1 OR (id = $2 AND id <> $3))`, [
          s.gerente_id,
          s.suplente_id,
          s.solicitante_id,
        ])
      : await db.query(
          `SELECT u.id, u.email FROM compras_firmantes f JOIN usuarios u ON u.id = f.usuario_id
            WHERE f.papel = $1 AND u.activo AND u.id <> $2`,
          [o.paso, s.solicitante_id],
        );
  return rows;
}

async function avisarOrden(solicitudId) {
  const s = await datosSolicitud(solicitudId);
  const o = await datosOrden(solicitudId);
  if (!s || !o) return;

  if (o.estado === "EN_FIRMAS") {
    if (!(await avisosEncendidos(true))) return;
    const firmantes = await firmantesDe(s, o);
    const que = { COMPRAS: " y pon el tipo", FINANZAS: " y pon la cuenta y el centro de costos" }[o.paso] || "";
    for (const u of firmantes) {
      await mandar({
        tipo: "OC_POR_FIRMAR",
        solicitudId,
        usuario: u,
        asunto: `Orden de compra por firmar: ${s.folio} · ${o.proveedor} · ${dinero(o.monto, o.moneda)}`,
        html: plantilla({
          titulo: "Tienes una orden de compra por firmar",
          subtitulo: `Firmas como ${PASO_TEXTO[o.paso]}`,
          cuerpo: `${fichaOrden(s, o)}
            <p style="font-size:14px;color:#6b7280">Revísala${que}. Firmas con tu PIN; si no procede, recházala con el motivo.</p>`,
          boton: { texto: "Revisar y firmar", url: enlaceOrdenes({ id: o.id }) },
        }),
        texto: `Orden de compra por firmar: ${s.folio} (${o.proveedor}, ${dinero(o.monto, o.moneda)}). ${enlaceOrdenes({ id: o.id })}`,
      });
    }
    return;
  }

  if (!(await avisosEncendidos())) return;
  const autorizada = o.estado === "AUTORIZADA";
  const destinatarios = [solicitanteDe(s), ...(await genteDeCompras(solicitudId))].filter(Boolean);
  const vistos = new Set();
  for (const u of destinatarios) {
    const clave = (u.email || "").toLowerCase();
    if (!clave || vistos.has(clave)) continue;
    vistos.add(clave);
    const esSolicitante = u.id === s.solicitante_id;
    await mandar({
      tipo: autorizada ? "OC_AUTORIZADA" : "OC_RECHAZADA",
      solicitudId,
      usuario: u,
      asunto: `${s.folio} (${s.osticket_numero}): orden de compra ${autorizada ? "autorizada" : "rechazada"}`,
      html: plantilla({
        titulo: autorizada ? "La orden de compra quedó autorizada" : "La orden de compra fue rechazada",
        subtitulo: `${escapar(s.folio)} · ${escapar(s.asunto)}`,
        cuerpo: `${fichaOrden(s, o, { conMontos: !esSolicitante })}${
          autorizada
            ? `<p style="font-size:14px;color:#6b7280">${
                esSolicitante
                  ? "Compras sigue con la compra sobre el mismo ticket."
                  : "Ya tiene todas las firmas: puedes colocar la orden con el proveedor."
              }</p>`
            : `<p><b>${escapar(o.rechazo)}</b> la rechazó (firmaba por ${PASO_TEXTO[o.rechazada_paso]}):</p>
               <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 12px;font-size:14px">${parrafos(o.motivo_rechazo)}</div>
               <p style="font-size:14px;color:#6b7280">La solicitud termina aquí. Si todavía hace falta, hay que pedirla de nuevo.</p>`
        }`,
        boton: esSolicitante
          ? { texto: "Ver la solicitud", url: enlace({ id: solicitudId }) }
          : { texto: "Ver la orden", url: enlaceOrdenes({ id: o.id }) },
      }),
      texto: autorizada
        ? `La orden de compra de ${s.folio} quedó autorizada.`
        : `${o.rechazo} rechazó la orden de compra de ${s.folio}: ${o.motivo_rechazo}`,
    });
  }
  if (autorizada) await avisarSobregiro(solicitudId);
}

/**
 * Después de un alta o una firma en lote: a cada quien que le toca firmar le
 * llega UN correo con todas sus órdenes, no uno por orden. Las que terminaron
 * (autorizadas o rechazadas) avisan una por una, como siempre.
 */
async function avisarOrdenes(solicitudIds = []) {
  const ids = [...new Set(solicitudIds)];
  if (ids.length === 1) return avisarOrden(ids[0]);
  const enFirmas = [];
  for (const id of ids) {
    const o = await datosOrden(id);
    if (!o) continue;
    if (o.estado === "EN_FIRMAS") enFirmas.push({ s: await datosSolicitud(id), o });
    else await avisarOrden(id);
  }
  if (!enFirmas.length || !(await avisosEncendidos(true))) return;

  const porUsuario = new Map();
  for (const x of enFirmas) {
    for (const u of await firmantesDe(x.s, x.o)) {
      if (!porUsuario.has(u.id)) porUsuario.set(u.id, { usuario: u, lista: [] });
      porUsuario.get(u.id).lista.push(x);
    }
  }
  for (const { usuario, lista } of porUsuario.values()) {
    if (lista.length === 1) {
      await avisarOrdenA(usuario, lista[0]);
      continue;
    }
    const celda = "padding:6px 10px;border-bottom:1px solid #f0f0f0";
    const filas = lista
      .map(
        ({ s, o }) => `
        <tr>
          <td style="${celda};white-space:nowrap"><a href="${escapar(enlaceOrdenes({ id: o.id }))}" style="color:#236093">${escapar(s.osticket_numero || s.folio)}</a></td>
          <td style="${celda}">${escapar(recortar(s.asunto, 60))}<br /><span style="color:#9ca3af;font-size:12px">${escapar(s.solicitante)} · ${escapar(s.area)}</span></td>
          <td style="${celda}">${escapar(recortar(o.proveedor, 50))}</td>
          <td style="${celda};text-align:right;white-space:nowrap">${dinero(o.monto, o.moneda)}</td>
        </tr>`,
      )
      .join("");
    const n = lista.length;
    const paso = lista[0].o.paso;
    const total = lista.every((x) => x.o.moneda === lista[0].o.moneda)
      ? dinero(lista.reduce((t, x) => t + x.o.monto, 0), lista[0].o.moneda)
      : null;
    await mandar({
      tipo: "OC_POR_FIRMAR",
      solicitudId: lista[0].s.id,
      usuario,
      asunto: `${n} órdenes de compra por firmar${total ? ` · ${total} sin IVA` : ""}`,
      html: plantilla({
        titulo: `Tienes ${n} órdenes de compra por firmar`,
        subtitulo: lista.every((x) => x.o.paso === paso) ? `Firmas como ${PASO_TEXTO[paso]}` : null,
        cuerpo: `
          <table style="border-collapse:collapse;width:100%;font-size:14px">
            <thead>
              <tr style="background:#236093;color:#fff">
                <th style="padding:8px 10px;text-align:left">Ticket</th>
                <th style="padding:8px 10px;text-align:left">Asunto</th>
                <th style="padding:8px 10px;text-align:left">Proveedor</th>
                <th style="padding:8px 10px;text-align:right">Monto sin IVA</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="font-size:14px;color:#6b7280">Puedes firmarlas juntas con tu PIN desde Órdenes de compra → Por firmar.</p>`,
        boton: { texto: "Revisar y firmar", url: enlaceOrdenes() },
      }),
      texto: `Tienes ${n} órdenes de compra por firmar: ${enlaceOrdenes()}`,
    });
  }
}

/** El correo de "por firmar" de una sola orden a una persona. */
async function avisarOrdenA(u, { s, o }) {
  const que = { COMPRAS: " y pon el tipo", FINANZAS: " y pon la cuenta y el centro de costos" }[o.paso] || "";
  await mandar({
    tipo: "OC_POR_FIRMAR",
    solicitudId: s.id,
    usuario: u,
    asunto: `Orden de compra por firmar: ${s.folio} · ${o.proveedor} · ${dinero(o.monto, o.moneda)}`,
    html: plantilla({
      titulo: "Tienes una orden de compra por firmar",
      subtitulo: `Firmas como ${PASO_TEXTO[o.paso]}`,
      cuerpo: `${fichaOrden(s, o)}
        <p style="font-size:14px;color:#6b7280">Revísala${que}. Firmas con tu PIN; si no procede, recházala con el motivo.</p>`,
      boton: { texto: "Revisar y firmar", url: enlaceOrdenes({ id: o.id }) },
    }),
    texto: `Orden de compra por firmar: ${s.folio} (${o.proveedor}, ${dinero(o.monto, o.moneda)}). ${enlaceOrdenes({ id: o.id })}`,
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
  avisarSobregiro,
  avisarOrden,
  avisarOrdenes,
  mandarRecordatorios,
  mandarPrueba,
  ultimosCorreos,
  leerConfig,
  guardarConfig,
  describirHorario,
  iniciarProgramado,
  enSegundoPlano,
};
