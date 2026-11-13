const fs = require("fs");
const Cotizacion = require("../models/CompraCotizacion");
const archivosCompras = require("../services/comprasArchivos.service");
const asignados = require("../services/asignadosCompras.service");
const avisos = require("../services/avisosCompras.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

const MODULO_LOG = "Cotizaciones de Compras";

function idDe(valor) {
  const id = parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Id inválido", 400);
  return id;
}

function log(req, accion, descripcion, registroId) {
  return registrarLog({
    usuarioId: req.usuario.id,
    accion,
    modulo: MODULO_LOG,
    tablaAfectada: "compras_cotizaciones",
    registroId,
    descripcion,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
}

/** Manda un archivo guardado, en línea (para ver fotos y PDF) o como descarga. */
function mandarArchivo(req, res, archivo) {
  const ruta = archivosCompras.rutaAbsoluta(archivo.ruta);
  if (!fs.existsSync(ruta)) throw new AppError("El archivo ya no está en el servidor", 410);
  res.setHeader("Content-Type", archivo.tipo_mime);
  res.setHeader(
    "Content-Disposition",
    `${req.query.descargar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(archivo.nombre_original)}`,
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  fs.createReadStream(ruta).pipe(res);
}

// =============================================
// BANDEJA DE COMPRAS
// =============================================

/**
 * GET /api/compras/cotizaciones?vista=por-cotizar|esperando|por-decidir|decididas
 *
 * Antes de responder lee de osTicket a quién está asignado cada ticket, si la
 * última lectura tiene más de un minuto. Si osTicket no responde, se usa lo
 * último que se leyó.
 */
const getBandeja = catchAsync(async (req, res) => {
  let aviso = null;
  try {
    await asignados.actualizarSiHaceFalta();
  } catch (e) {
    aviso = `No se pudo leer de osTicket a quién está asignado cada ticket; se muestra lo último que se leyó (${e.message}).`;
  }
  const [lista, contadores] = await Promise.all([
    Cotizacion.listar(req.usuario, req.query.vista || "por-cotizar"),
    Cotizacion.contar(req.usuario),
  ]);
  sendSuccess(res, 200, { ...lista, contadores, aviso });
});

/** GET /api/compras/cotizaciones/:id */
const getSolicitud = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Cotizacion.obtener(idDe(req.params.id), req.usuario));
});

/** PUT /api/compras/cotizaciones/:id/borrador */
const putBorrador = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Cotizacion.guardarBorrador(idDe(req.params.id), req.usuario, req.body), "Borrador guardado");
});

/** POST /api/compras/cotizaciones/:id/archivos  (multipart: archivos[]) */
const postArchivos = catchAsync(async (req, res) => {
  try {
    if (!req.files?.length) throw new AppError("No se recibió ningún archivo", 400);
    const excede = archivosCompras.excedeTotal(req.files);
    if (excede) throw new AppError(excede, 400);
    const nuevos = await Cotizacion.agregarArchivos(idDe(req.params.id), req.usuario, archivosCompras.describir(req.files));
    sendSuccess(res, 201, nuevos);
  } catch (e) {
    archivosCompras.borrar(req.files);
    throw e;
  }
});

/** POST /api/compras/cotizaciones/:id/enviar */
const postEnviar = catchAsync(async (req, res) => {
  const r = await Cotizacion.enviar(idDe(req.params.id), req.usuario);
  await log(req, "UPDATE", `Mandó ${r.opciones} opciones de proveedores para ${r.folio}`, r.id);
  avisos.enSegundoPlano(avisos.avisarCotizada, r.id);
  sendSuccess(res, 200, r, `Opciones enviadas a quien pidió ${r.folio}`);
});

/** POST /api/compras/cotizaciones/:id/decidir   { opcionId, nota } */
const postDecidir = catchAsync(async (req, res) => {
  const r = await Cotizacion.decidir(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "UPDATE", `Decidió ${r.proveedor} por ${r.monto} ${r.moneda} en ${r.folio}`, r.id);
  avisos.enSegundoPlano(avisos.avisarDecidida, r.id);
  sendSuccess(res, 200, r, `Decidiste a ${r.proveedor}. Ya se le avisó a quien pidió.`);
});

/** GET /api/compras/cotizaciones/:id/solicitud-archivos/:archivoId */
const getArchivoSolicitud = catchAsync(async (req, res) => {
  mandarArchivo(
    req,
    res,
    await Cotizacion.obtenerArchivoSolicitud(idDe(req.params.id), idDe(req.params.archivoId), req.usuario),
  );
});

/** GET /api/compras/cotizacion-archivos/:archivoId — lo ve Compras y, ya enviada, quien pidió. */
const getArchivoCotizacion = catchAsync(async (req, res) => {
  mandarArchivo(req, res, await Cotizacion.obtenerArchivo(idDe(req.params.archivoId), req.usuario));
});

// =============================================
// LO QUE HACE QUIEN PIDIÓ
// =============================================

/** POST /api/compras/solicitudes/:id/sugerir   { opcionId, comentario } */
const postSugerir = catchAsync(async (req, res) => {
  const r = await Cotizacion.sugerir(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "UPDATE", `Sugirió ${r.proveedor} en ${r.folio}`, r.id);
  avisos.enSegundoPlano(avisos.avisarSugerida, r.id);
  sendSuccess(res, 200, r, `${r.cambio ? "Cambiaste tu sugerencia" : "Sugeriste"} a ${r.proveedor}. Compras ya fue avisado y decide.`);
});

/** POST /api/compras/solicitudes/:id/otras-opciones   { motivo } */
const postOtrasOpciones = catchAsync(async (req, res) => {
  const r = await Cotizacion.pedirOtras(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "UPDATE", `Pidió otras opciones para ${r.folio}`, r.id);
  avisos.enSegundoPlano(avisos.avisarOtrasOpciones, r.id);
  sendSuccess(res, 200, r, "Le pediste a Compras otras opciones");
});

module.exports = {
  getBandeja,
  getSolicitud,
  putBorrador,
  postArchivos,
  postEnviar,
  getArchivoSolicitud,
  getArchivoCotizacion,
  postDecidir,
  postSugerir,
  postOtrasOpciones,
};
