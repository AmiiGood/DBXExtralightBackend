const Reporte = require("../models/CustomerServiceReporte");
const sincronizador = require("../services/sincronizarCustomerService.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/** Lista separada por comas → arreglo, o undefined si no vino. */
function lista(v) {
  if (!v) return undefined;
  const a = String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return a.length ? a : undefined;
}

/** Filtros de las muestras. */
function filtrosMuestras(req) {
  const q = req.query;
  return {
    periodos: lista(q.periodo),
    bus: lista(q.bu),
    familias: lista(q.familia),
    tipos: lista(q.tipo),
    areas: lista(q.area),
    clientes: lista(q.cliente),
    estados: lista(q.estado),
    fechaInicio: q.fechaInicio || undefined,
    fechaFin: q.fechaFin || undefined,
  };
}

/** La frescura del dato viaja con el dato, igual que en Moldes y TI. */
async function estadoArchivos() {
  const archivos = await sincronizador.listarArchivos();
  return archivos.map((a) => ({
    clave: a.clave,
    nombre: a.nombre,
    archivo: a.archivo,
    activo: a.activo,
    filas: a.filas,
    leido: a.leido_texto,
    modificado: a.modificado_texto,
    error: a.ultimo_error,
    errorEn: a.error_texto,
  }));
}

// =============================================
// REPORTE
// =============================================

/**
 * GET /api/customer-service/reportes/filtros
 */
const getFiltros = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Reporte.filtros());
});

/**
 * GET /api/customer-service/reportes/kpi
 *
 * @query anio        año del tablero (obligatorio en la práctica)
 * @query indicador   OTS | OTIF | SC, para la serie semanal
 * @query bu          lista separada por comas
 */
const getKpi = catchAsync(async (req, res) => {
  const anio = req.query.anio ? parseInt(req.query.anio, 10) : undefined;
  if (!anio) throw new AppError("Falta el año", 400);

  const indicador = (req.query.indicador || "OTIF").toUpperCase();
  if (!Reporte.INDICADORES[indicador]) {
    throw new AppError(`Indicador no válido: "${indicador}"`, 400);
  }
  const bus = lista(req.query.bu);

  const [resumen, serie, anual, unidades] = await Promise.all([
    Reporte.kpiResumen({ anio }),
    Reporte.kpiSerie({ indicador, anio, bus }),
    Reporte.kpiAnual({ bus }),
    Reporte.kpiPorUnidad({ indicador, anio }),
  ]);

  sendSuccess(res, 200, {
    anio,
    indicador,
    resumen,
    serie,
    anual,
    unidades,
    archivos: await estadoArchivos(),
  });
});

/**
 * GET /api/customer-service/reportes/muestras
 *
 * @query corte   familia | tipo | bu | area | cliente | periodo | estado
 * @query …       los filtros de `filtrosMuestras`
 */
const getMuestras = catchAsync(async (req, res) => {
  const f = filtrosMuestras(req);
  const corte = req.query.corte || "familia";
  if (!Reporte.CORTES[corte]) throw new AppError(`Corte no válido: "${corte}"`, 400);

  const [resumen, porCorte, porFamilia, porEstado, mensual, desvio, dispersion, clientes] =
    await Promise.all([
      Reporte.muestrasResumen(f),
      Reporte.muestrasPorCorte(f, corte),
      Reporte.muestrasPorCorte(f, "familia"),
      Reporte.muestrasPorCorte(f, "periodo"),
      Reporte.muestrasMensual(f),
      Reporte.muestrasDesvio(f),
      Reporte.muestrasDispersion(f),
      Reporte.muestrasPorCorte(f, "cliente", 12),
    ]);

  sendSuccess(res, 200, {
    corte,
    resumen,
    porCorte,
    porFamilia,
    porPeriodo: porEstado,
    mensual,
    desvio,
    dispersion,
    clientes,
    archivos: await estadoArchivos(),
  });
});

/**
 * GET /api/customer-service/reportes/muestras/detalle
 */
const getMuestrasDetalle = catchAsync(async (req, res) => {
  const datos = await Reporte.muestrasDetalle(filtrosMuestras(req), {
    limite: Math.min(parseInt(req.query.limite, 10) || 500, 5000),
    pagina: parseInt(req.query.pagina, 10) || 1,
  });
  sendSuccess(res, 200, datos);
});

// =============================================
// ARCHIVOS VIGILADOS
// =============================================

/**
 * GET /api/customer-service/archivos
 */
const getArchivos = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.estado());
});

/**
 * PUT /api/customer-service/archivos/:clave
 *
 * Cambia la carpeta, el nombre del archivo o si se vigila. Es lo que se usa en
 * enero, cuando el libro cambia de año y con él su nombre.
 */
const putArchivo = catchAsync(async (req, res) => {
  const { carpeta, archivo, activo } = req.body;
  if (carpeta === undefined && archivo === undefined && activo === undefined) {
    throw new AppError("No se mandó ningún cambio", 400);
  }

  const actualizado = await sincronizador.guardarConfiguracion(req.params.clave, {
    carpeta,
    archivo,
    activo,
  });
  if (!actualizado) throw new AppError("No existe ese archivo configurado", 404);

  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "ACTUALIZAR",
    modulo: "Archivos de Customer Service",
    tablaAfectada: "cs_archivos",
    descripcion:
      `Archivo de Customer Service "${req.params.clave}": ` +
      `${actualizado.carpeta}\\${actualizado.archivo}` +
      (activo === undefined ? "" : activo ? " (activo)" : " (inactivo)"),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  sendSuccess(res, 200, actualizado, "Archivo actualizado");
});

/**
 * POST /api/customer-service/archivos/:clave/probar
 *
 * Revisa que la ruta se alcance SIN cargar nada. Es lo primero que hay que
 * correr cuando el servidor todavía no tiene permisos al recurso compartido:
 * contesta si el problema es el permiso, la ruta o el nombre del archivo.
 */
const probarArchivo = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await sincronizador.probar(req.params.clave));
});

/**
 * POST /api/customer-service/archivos/sincronizar
 *
 * @body clave    opcional, para sincronizar solo uno
 * @body forzar   relee aunque el archivo no haya cambiado
 */
const sincronizar = catchAsync(async (req, res) => {
  const { clave, forzar } = req.body || {};
  const opciones = { forzar: Boolean(forzar), usuarioId: req.usuario?.id };

  const resultado = clave
    ? [await sincronizador.sincronizarArchivo(String(clave).toUpperCase(), opciones)]
    : await sincronizador.sincronizar(opciones);

  const cambiaron = resultado.filter((r) => r.ok && !r.sinCambios);
  await registrarLog({
    usuarioId: req.usuario?.id,
    accion: "SYNC",
    modulo: "Archivos de Customer Service",
    tablaAfectada: "cs_archivos",
    descripcion:
      cambiaron.length === 0
        ? "Customer Service: sin cambios en los archivos"
        : "Customer Service: " +
          cambiaron.map((r) => `${r.clave} ${r.guardadas} renglones`).join(", "),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  const fallaron = resultado.filter((r) => r.ok === false);
  sendSuccess(
    res,
    200,
    { resultado, estado: await sincronizador.estado() },
    fallaron.length
      ? `No se pudo leer: ${fallaron.map((r) => r.clave).join(", ")}`
      : cambiaron.length
        ? "Archivos actualizados"
        : "Los archivos no han cambiado desde la última lectura",
  );
});

module.exports = {
  getFiltros,
  getKpi,
  getMuestras,
  getMuestrasDetalle,
  getArchivos,
  putArchivo,
  probarArchivo,
  sincronizar,
};
