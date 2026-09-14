const db = require("../config/database");
const InyeccionReporte = require("../models/InyeccionReporte");
const { generarPdfInyeccion } = require("./pdfReporte.service");
const correo = require("./correo.service");

/**
 * Arma y manda un reporte por correo.
 *
 * El periodo se resuelve al momento del envío, no cuando se creó la
 * programación: si se guardara fijo, cada lunes llegaría el mismo enero de 2026.
 */

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Convierte 'SEMANA_ANTERIOR' y compañía al rango concreto de fechas.
 *
 * @param {String} relativo
 * @param {Object} filtrosFijos  se usan tal cual cuando relativo = 'FIJO'
 * @param {Date}   ahora         inyectable para poder probarlo
 * @returns {{filtros, agrupar, etiqueta}}
 */
function resolverPeriodo(relativo, filtrosFijos = {}, ahora = new Date()) {
  const y = ahora.getFullYear();
  const m = ahora.getMonth() + 1;
  const dd = (v) => String(v).padStart(2, "0");
  const iso = (d) =>
    `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;

  switch (relativo) {
    case "SEMANA_ANTERIOR": {
      // Lunes a domingo de la semana pasada
      const hoy = new Date(ahora);
      const diaSemana = (hoy.getDay() + 6) % 7; // 0 = lunes
      const lunesEsta = new Date(hoy);
      lunesEsta.setDate(hoy.getDate() - diaSemana);
      const lunes = new Date(lunesEsta);
      lunes.setDate(lunesEsta.getDate() - 7);
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);
      return {
        filtros: { fechaInicio: iso(lunes), fechaFin: iso(domingo) },
        agrupar: "fecha",
        etiqueta: `semana del ${iso(lunes)} al ${iso(domingo)}`,
      };
    }
    case "MES_ANTERIOR": {
      const anio = m === 1 ? y - 1 : y;
      const mes = m === 1 ? 12 : m - 1;
      return {
        filtros: { anio, mes },
        agrupar: "fecha",
        etiqueta: `${MESES[mes - 1]} de ${anio}`,
      };
    }
    case "MES_ACTUAL":
      return {
        filtros: { anio: y, mes: m },
        agrupar: "fecha",
        etiqueta: `${MESES[m - 1]} de ${y} (en curso)`,
      };
    case "TRIMESTRE_ANTERIOR": {
      const tActual = Math.floor((m - 1) / 3) + 1;
      const anio = tActual === 1 ? y - 1 : y;
      const t = tActual === 1 ? 4 : tActual - 1;
      return {
        filtros: { anio, trimestre: t },
        agrupar: "mes",
        etiqueta: `T${t} de ${anio}`,
      };
    }
    case "ANIO_ACTUAL":
      return {
        filtros: { anio: y },
        agrupar: "mes",
        etiqueta: `${y} (en curso)`,
      };
    case "FIJO":
    default:
      return {
        filtros: filtrosFijos || {},
        agrupar: filtrosFijos?.agrupar || "mes",
        etiqueta: "periodo fijo",
      };
  }
}

/** Cuerpo del correo. Sobrio: esto lo abren directivos. */
function cuerpoHtml({ nombre, etiqueta, mensaje, porBu }) {
  const filas = (porBu || [])
    .filter((r) => r.bu)
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0">${r.bu}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right">
          ${Number(r.produccion || 0).toLocaleString("es-MX")}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:right">
          ${r.pct_scrap == null ? "—" : Number(r.pct_scrap).toFixed(2) + "%"}</td>
      </tr>`,
    )
    .join("");

  return `
  <div style="font-family:Segoe UI,Arial,sans-serif;color:#111827;max-width:640px">
    <h2 style="color:#236093;margin:0 0 4px">${nombre}</h2>
    <p style="color:#6b7280;margin:0 0 16px">Producción Inyección · ${etiqueta}</p>
    ${mensaje ? `<p>${mensaje}</p>` : ""}
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead>
        <tr style="background:#236093;color:#fff">
          <th style="padding:8px 10px;text-align:left">Unidad de negocio</th>
          <th style="padding:8px 10px;text-align:right">Piezas producidas</th>
          <th style="padding:8px 10px;text-align:right">% Scrap</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="color:#9ca3af;font-size:12px;margin-top:14px">
      Cada unidad de negocio es un componente distinto; no se suman entre sí.
      El detalle completo va en el PDF adjunto.
    </p>
    <p style="color:#9ca3af;font-size:11px;margin-top:18px;border-top:1px solid #eee;padding-top:10px">
      Enviado automáticamente por DBX Extralight. No respondas a este correo.
    </p>
  </div>`;
}

/**
 * Ejecuta una programación: arma el reporte, lo manda y deja bitácora.
 *
 * Nunca lanza: un fallo de correo no debe tumbar el planificador. El error se
 * guarda en reportes_envios para que se vea en la pantalla de bitácora.
 *
 * @param {Object} prog  fila de reportes_programados (con lista_nombre)
 * @param {Object} opciones { disparo: 'PROGRAMADO'|'MANUAL', usuarioId, soloA }
 */
async function ejecutarProgramacion(prog, opciones = {}) {
  const inicio = Date.now();
  const disparo = opciones.disparo || "PROGRAMADO";
  let destinatarios = [];
  let asunto = null;
  let periodo = null;

  try {
    const { filtros, agrupar, etiqueta } = resolverPeriodo(
      prog.periodo_relativo,
      prog.filtros,
    );
    periodo = etiqueta;

    // Destinatarios: SIEMPRE de la lista, nunca de texto libre
    if (opciones.soloA?.length) {
      destinatarios = opciones.soloA;
    } else {
      const { rows } = await db.query(
        `SELECT correo FROM listas_correo_miembros
          WHERE lista_id = $1 AND activo = true ORDER BY correo`,
        [prog.lista_id],
      );
      destinatarios = rows.map((r) => r.correo);
    }
    if (destinatarios.length === 0) {
      throw new Error("La lista de correo no tiene destinatarios activos");
    }

    const datos = await InyeccionReporte.getDashboard(filtros, agrupar);
    if (!datos.totales?.registros) {
      throw new Error(`No hay registros en el periodo (${etiqueta})`);
    }

    const pdf = await generarPdfInyeccion(datos, {
      titulo: prog.nombre,
      periodo: `Periodo: ${etiqueta}`,
      generadoPor: "DBX Extralight",
      filtros: prog.periodo_relativo,
    });

    asunto =
      prog.asunto || `${prog.nombre} — ${etiqueta}`;
    const nombreArchivo = `Produccion Inyeccion - ${etiqueta.replace(/[^\w\s-]/g, "")}.pdf`;

    const resultado = await correo.enviar({
      para: destinatarios,
      asunto,
      html: cuerpoHtml({
        nombre: prog.nombre,
        etiqueta,
        mensaje: prog.mensaje,
        porBu: datos.porBu,
      }),
      texto:
        `${prog.nombre}\nProducción Inyección · ${etiqueta}\n\n` +
        (datos.porBu || [])
          .filter((r) => r.bu)
          .map(
            (r) =>
              `${r.bu}: ${Number(r.produccion || 0).toLocaleString("es-MX")} piezas, ` +
              `${r.pct_scrap == null ? "—" : r.pct_scrap + "%"} de scrap`,
          )
          .join("\n") +
        "\n\nEl detalle completo va en el PDF adjunto.",
      adjuntos: [
        { filename: nombreArchivo, content: pdf, contentType: "application/pdf" },
      ],
    });

    await db.query(
      `INSERT INTO reportes_envios
         (programado_id, disparo, estado, destinatarios, asunto, periodo,
          adjuntos, bytes, duracion_ms, enviado_por)
       VALUES ($1,$2,'ENVIADO',$3,$4,$5,$6,$7,$8,$9)`,
      [
        prog.id || null,
        disparo,
        destinatarios,
        asunto,
        periodo,
        JSON.stringify([{ nombre: nombreArchivo, bytes: pdf.length }]),
        pdf.length,
        Date.now() - inicio,
        opciones.usuarioId || null,
      ],
    );

    if (prog.id) {
      await db.query(
        `UPDATE reportes_programados SET ultima_ejecucion = now() WHERE id = $1`,
        [prog.id],
      );
    }

    return {
      ok: true,
      destinatarios,
      asunto,
      periodo,
      bytes: pdf.length,
      modo: resultado.modo,
      vistaPrevia: resultado.vistaPrevia,
      duracionMs: Date.now() - inicio,
    };
  } catch (error) {
    await db
      .query(
        `INSERT INTO reportes_envios
           (programado_id, disparo, estado, destinatarios, asunto, periodo,
            duracion_ms, error, enviado_por)
         VALUES ($1,$2,'ERROR',$3,$4,$5,$6,$7,$8)`,
        [
          prog.id || null,
          disparo,
          destinatarios,
          asunto,
          periodo,
          Date.now() - inicio,
          error.message,
          opciones.usuarioId || null,
        ],
      )
      .catch(() => {});
    return { ok: false, error: error.message, destinatarios, periodo };
  }
}

module.exports = { ejecutarProgramacion, resolverPeriodo, cuerpoHtml };
