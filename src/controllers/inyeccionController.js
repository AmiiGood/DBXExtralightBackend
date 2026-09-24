const InyeccionReporte = require("../models/InyeccionReporte");
const InyeccionCaptura = require("../models/InyeccionCaptura");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/**
 * Convierte los query params a los filtros que espera el modelo.
 */
function leerFiltros(req) {
  const { fechaInicio, fechaFin, anio, mes, semana, trimestre, semestre, bu } =
    req.query;
  return {
    fechaInicio: fechaInicio || undefined,
    fechaFin: fechaFin || undefined,
    anio: anio ? parseInt(anio, 10) : undefined,
    mes: mes ? parseInt(mes, 10) : undefined,
    semana: semana ? parseInt(semana, 10) : undefined,
    trimestre: trimestre ? parseInt(trimestre, 10) : undefined,
    semestre: semestre ? parseInt(semestre, 10) : undefined,
    bu: bu
      ? String(bu)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  };
}

/**
 * GET /api/inyeccion/reportes/filtros
 * Valores disponibles para los slicers (años, meses, semanas, BUs, máquinas).
 */
const getFiltros = catchAsync(async (req, res) => {
  const filtros = await InyeccionReporte.getFiltros();
  sendSuccess(res, 200, filtros);
});

/**
 * GET /api/inyeccion/reportes/dashboard
 * Todas las series de las páginas Inj e Inj 2 en una sola llamada.
 *
 * @query fechaInicio, fechaFin  AAAA-MM-DD
 * @query anio, mes, semana      número
 * @query bu                     lista separada por comas
 * @query agrupar                anio | mes | semana | fecha  (default: mes)
 */
const getDashboard = catchAsync(async (req, res) => {
  const datos = await InyeccionReporte.getDashboard(
    leerFiltros(req),
    req.query.agrupar || "mes",
  );
  sendSuccess(res, 200, datos);
});

/**
 * GET /api/inyeccion/reportes/comparar
 * Compara dos periodos del mismo tipo.
 *
 * @query tipo     mes | trimestre | semestre | anio
 * @query aAnio, aNum   periodo A
 * @query bAnio, bNum   periodo B
 * @query bu       lista separada por comas (opcional)
 */
const getComparativo = catchAsync(async (req, res) => {
  const { tipo, aAnio, aNum, bAnio, bNum, bu } = req.query;
  const datos = await InyeccionReporte.getComparativo(
    tipo || "mes",
    { anio: parseInt(aAnio, 10), numero: parseInt(aNum, 10) || 1 },
    { anio: parseInt(bAnio, 10), numero: parseInt(bNum, 10) || 1 },
    bu
      ? String(bu)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );
  sendSuccess(res, 200, datos);
});

// =============================================
// CARGA DEL EXCEL
// =============================================

const {
  analizarArchivo,
  importarArchivo,
} = require("../services/importarInyeccion.service");
const fs = require("fs");

/** Borra el temporal de multer pase lo que pase. */
function limpiar(ruta) {
  if (ruta) fs.promises.unlink(ruta).catch(() => {});
}

/**
 * multer entrega el nombre del archivo interpretado como latin1, así que un
 * "Producción" llega como "ProducciÃ³n". Se vuelve a leer como UTF-8.
 */
function nombreOriginal(file) {
  if (!file?.originalname) return "carga.xlsx";
  try {
    return Buffer.from(file.originalname, "latin1").toString("utf8");
  } catch {
    return file.originalname;
  }
}

/**
 * POST /api/inyeccion/carga/analizar
 * Lee el archivo y dice qué contiene, SIN escribir nada en la base.
 */
const analizarCarga = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError("No se recibió ningún archivo", 400));
  try {
    sendSuccess(res, 200, await analizarArchivo(req.file.path));
  } catch (e) {
    return next(new AppError(e.message, e.statusCode || 400));
  } finally {
    limpiar(req.file?.path);
  }
});

/**
 * POST /api/inyeccion/carga/importar
 * Carga el archivo. Reemplaza el rango de fechas que trae, pero solo lo que
 * cargó una importación previa: lo capturado a mano no se toca.
 *
 * @body reemplazar  'true' para confirmar cuando ya hay datos en ese rango
 */
const importarCarga = catchAsync(async (req, res, next) => {
  if (!req.file) return next(new AppError("No se recibió ningún archivo", 400));
  try {
    const resultado = await importarArchivo(req.file.path, {
      nombreArchivo: nombreOriginal(req.file),
      usuarioId: req.usuario.id,
      reemplazar: String(req.body?.reemplazar) === "true",
    });

    await registrarLog({
      usuarioId: req.usuario.id,
      accion: "IMPORT",
      modulo: "Carga de Producción",
      tablaAfectada: "iny_produccion",
      // El id de carga es un uuid y logs_sistema.registro_id es integer:
      // pasarlo ahí hacía fallar el INSERT del log y la importación se quedaba
      // sin registrar. Va en la descripción, que es texto.
      descripcion:
        `Carga de "${nombreOriginal(req.file)}": ${resultado.insertadas} filas ` +
        `(${resultado.fechaMin} a ${resultado.fechaMax})` +
        (resultado.reemplazados ? `, reemplazó ${resultado.reemplazados}` : "") +
        `. Carga ${resultado.cargaId}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    sendSuccess(res, 200, resultado, "Archivo cargado");
  } catch (e) {
    // 409 = ya hay datos en ese rango y falta confirmar el reemplazo
    const err = new AppError(e.message, e.statusCode || 500);
    err.detalle = e.detalle;
    return next(err);
  } finally {
    limpiar(req.file?.path);
  }
});

/**
 * GET /api/inyeccion/carga/historial
 * Últimas cargas hechas.
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  const db = require("../config/database");
  const { rows } = await db.query(
    `SELECT c.id, c.nombre_archivo, c.total_registros, c.registros_nuevos,
            c.registros_omitidos, c.creado_en, u.nombre_completo AS usuario,
            (SELECT min(fecha) FROM iny_produccion p WHERE p.carga_id = c.id) AS desde,
            (SELECT max(fecha) FROM iny_produccion p WHERE p.carga_id = c.id) AS hasta
       FROM iny_cargas c
       LEFT JOIN usuarios u ON u.id = c.cargado_por
      ORDER BY c.id DESC LIMIT 20`,
  );
  sendSuccess(res, 200, { cargas: rows });
});

// =============================================
// CAPTURA
// =============================================

/**
 * GET /api/inyeccion/captura/catalogos
 * Máquinas activas con sus estaciones, y turnos.
 */
const getCatalogosCaptura = catchAsync(async (req, res) => {
  const catalogos = await InyeccionCaptura.getCatalogos();
  sendSuccess(res, 200, catalogos);
});

/**
 * GET /api/inyeccion/productos?q=&bu=
 * Autocompletar de producto semiterminado.
 */
const buscarProductos = catchAsync(async (req, res, next) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    return next(new AppError("Escribe al menos 2 caracteres para buscar", 400));
  }
  const productos = await InyeccionCaptura.buscarProductos(q, req.query.bu);
  sendSuccess(res, 200, { productos });
});

/**
 * GET /api/inyeccion/captura?fecha=&maquinaId=&turnoId=
 * Lo ya capturado para ese turno (vacío si es captura nueva).
 */
const getCaptura = catchAsync(async (req, res) => {
  const { fecha, maquinaId, turnoId } = req.query;
  const renglones = await InyeccionCaptura.getCaptura(
    fecha,
    parseInt(maquinaId, 10),
    parseInt(turnoId, 10),
  );
  sendSuccess(res, 200, { renglones });
});

/**
 * GET /api/inyeccion/captura/avance?fecha=
 * Qué máquinas y turnos ya tienen captura ese día.
 */
const getAvanceDelDia = catchAsync(async (req, res) => {
  const avance = await InyeccionCaptura.getAvanceDelDia(req.query.fecha);
  sendSuccess(res, 200, { avance });
});

/**
 * POST /api/inyeccion/captura
 * Guarda el turno completo en una transacción.
 */
const guardarCaptura = catchAsync(async (req, res, next) => {
  const { fecha, maquinaId, turnoId, renglones, eliminados } = req.body;

  // Las estaciones deben pertenecer a la máquina del encabezado: si no, se
  // estarían colgando renglones de una máquina en otra.
  const catalogos = await InyeccionCaptura.getCatalogos();
  const maquina = catalogos.maquinas.find((m) => m.id === Number(maquinaId));
  if (!maquina) {
    return next(new AppError("La máquina no existe o está inactiva", 400));
  }
  const idsValidos = new Set(maquina.estaciones.map((e) => e.id));
  const intrusa = (renglones || []).find(
    (r) => r.estacionId != null && !idsValidos.has(Number(r.estacionId)),
  );
  if (intrusa) {
    return next(
      new AppError(
        `La estación ${intrusa.estacionId} no pertenece a la máquina ${maquina.codigo}`,
        400,
      ),
    );
  }

  const resultado = await InyeccionCaptura.guardar(
    { fecha, maquinaId: Number(maquinaId), turnoId: Number(turnoId), renglones, eliminados },
    req.usuario.id,
  );

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPSERT",
    modulo: "Producción Inyección",
    tablaAfectada: "iny_produccion",
    descripcion:
      `Captura ${fecha} · ${maquina.codigo} · turno ${turnoId}: ` +
      `${resultado.insertados} nuevos, ${resultado.actualizados} editados, ` +
      `${resultado.eliminados} borrados`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: resultado,
  });

  sendSuccess(res, 200, resultado, "Captura guardada");
});

module.exports = {
  getFiltros,
  getDashboard,
  getComparativo,
  analizarCarga,
  importarCarga,
  getHistorialCargas,
  getCatalogosCaptura,
  buscarProductos,
  getCaptura,
  getAvanceDelDia,
  guardarCaptura,
};
