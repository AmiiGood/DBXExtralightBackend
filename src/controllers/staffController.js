const StaffReporte = require("../models/StaffReporte");
const {
  analizarArchivo,
  importarArchivo,
  historialCargas,
} = require("../services/importarStaff.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");
const fs = require("fs");

const { BLOQUES } = StaffReporte;

/** Valida el bloque antes de llegar al modelo, para dar un 400 y no un 500. */
function leerBloque(req) {
  const bloque = String(req.query.bloque || "INVOICE").toUpperCase();
  if (!BLOQUES.includes(bloque)) {
    throw new AppError(
      `Bloque desconocido: "${bloque}". Se espera ${BLOQUES.join(", ")}.`,
      400,
    );
  }
  return bloque;
}

// =============================================
// REPORTES
// =============================================

/**
 * GET /api/staff/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await StaffReporte.getFiltros());
});

/**
 * GET /api/staff/reportes/serie
 *
 * @query bloque   INVOICE | INYECCION | ENSAMBLE | ROTACION  (default: INVOICE)
 * @query anio     AAAA
 * @query vista    junta | mes | semana                       (default: junta)
 * @query semanas  cuántas semanas sueltas trae la vista 'junta' (default: 4)
 */
const getSerie = catchAsync(async (req, res) => {
  const datos = await StaffReporte.getSerie(leerBloque(req), {
    anio: req.query.anio ? parseInt(req.query.anio, 10) : undefined,
    vista: req.query.vista,
    semanas: req.query.semanas ? parseInt(req.query.semanas, 10) : undefined,
  });
  sendSuccess(res, 200, datos);
});

/**
 * GET /api/staff/reportes/trimestres
 * La tabla de promedio diario por trimestre de la presentación.
 */
const getTrimestres = catchAsync(async (req, res) => {
  const anio = parseInt(req.query.anio, 10);
  if (!anio) throw new AppError("Falta el año", 400);
  sendSuccess(res, 200, await StaffReporte.getPromedioTrimestre(leerBloque(req), anio));
});

/**
 * GET /api/staff/reportes/open-po
 * Foto de la PO abierta. Sin corte devuelve el más reciente.
 */
const getOpenPo = catchAsync(async (req, res) => {
  const datos = await StaffReporte.getOpenPo({
    anio: req.query.anio ? parseInt(req.query.anio, 10) : undefined,
    semana: req.query.semana ? parseInt(req.query.semana, 10) : undefined,
  });
  sendSuccess(res, 200, datos);
});

// =============================================
// CARGA DEL EXCEL
// =============================================

/** Borra el temporal de multer pase lo que pase. */
function limpiarTemporal(file) {
  if (file?.path) fs.unlink(file.path, () => {});
}

/**
 * multer decodifica el nombre como latin1; sin esto un archivo con acentos
 * llega como "JUNTA DE STAFF SEMANA 35 - Producciรณn.xlsx".
 *
 * Aquí importa más que en otros módulos: la semana de corte de la PO abierta
 * sale del nombre del archivo y de ningún otro lado.
 */
const nombreOriginal = (file) =>
  file ? Buffer.from(file.originalname, "latin1").toString("utf8") : null;

/** Semana de corte forzada desde la pantalla, cuando el nombre no la trae. */
function leerCorte(req) {
  const semana = parseInt(req.body?.semana, 10);
  if (!semana) return null;
  if (semana < 1 || semana > 53) {
    throw new AppError("La semana de corte debe estar entre 1 y 53", 400);
  }
  const anio = parseInt(req.body?.anio, 10) || new Date().getFullYear();
  return { semana, anio };
}

/**
 * POST /api/staff/carga/analizar
 * Describe lo que trae el archivo sin escribir nada.
 */
const analizarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const resumen = await analizarArchivo(req.file.path, nombre);
    const corte = leerCorte(req);
    sendSuccess(res, 200, {
      ...resumen,
      archivo: nombre,
      // Lo que el usuario escribió manda sobre lo que se dedujo del nombre
      corte: corte || resumen.corte,
    });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * POST /api/staff/carga/importar
 */
const importarCarga = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError("No se recibió ningún archivo", 400);
  try {
    const nombre = nombreOriginal(req.file);
    const resultado = await importarArchivo(req.file.path, {
      usuarioId: req.usuario?.id,
      nombreArchivo: nombre,
      corte: leerCorte(req),
    });

    await registrarLog({
      usuarioId: req.usuario?.id,
      accion: "IMPORT",
      modulo: "Reportes de STAFF",
      tablaAfectada: "staff_valores",
      // El id de carga es un uuid y logs_sistema.registro_id es integer:
      // pasarlo ahí hacía fallar el INSERT del log y la importación se quedaba
      // sin registrar. Va en la descripción, que es texto.
      descripcion:
        `Carga de "${nombre}": ${resultado.valores} valores ` +
        `(${resultado.periodoMin} a ${resultado.periodoMax})` +
        (resultado.openPoFilas
          ? `, ${resultado.openPoFilas} renglones de PO abierta ` +
            `del corte semana ${resultado.corte.semana} de ${resultado.corte.anio}`
          : "") +
        `. Carga ${resultado.cargaId}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });

    sendSuccess(res, 200, { ...resultado, archivo: nombre });
  } finally {
    limpiarTemporal(req.file);
  }
});

/**
 * GET /api/staff/carga/historial
 */
const getHistorialCargas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await historialCargas());
});

module.exports = {
  getFiltros,
  getSerie,
  getTrimestres,
  getOpenPo,
  analizarCarga,
  importarCarga,
  getHistorialCargas,
};
