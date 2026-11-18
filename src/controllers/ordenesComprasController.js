const fs = require("fs");
const Orden = require("../models/CompraOrden");
const avisos = require("../services/avisosCompras.service");
const asignados = require("../services/asignadosCompras.service");
const archivosCompras = require("../services/comprasArchivos.service");
const pdfOrden = require("../services/pdfOrdenCompra.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

const MODULO_LOG = "Órdenes de compra";
const PASO = { GERENTE: "gerente", COMPRAS: "Compras", FINANZAS: "Finanzas", DIRECCION: "Dirección" };

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
    tablaAfectada: "compras_ordenes",
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

/** GET /api/compras/ordenes?vista=por-firmar|firmadas|todas */
const getOrdenes = catchAsync(async (req, res) => {
  const vista = req.query.vista || "por-firmar";
  const [ordenes, porFirmar, verTodas, alcance] = await Promise.all([
    Orden.listar(req.usuario, vista),
    Orden.contarPorFirmar(req.usuario),
    Orden.verTodas(req.usuario),
    Orden.alcanceAlta(req.usuario),
  ]);
  const porDarDeAlta = alcance.crear ? await Orden.contarPorDarDeAlta(req.usuario) : 0;
  sendSuccess(res, 200, { vista, ordenes, porFirmar, verTodas, darDeAlta: alcance.crear, porDarDeAlta });
});

// =============================================
// ALTA DE LA ORDEN (Compras)
// =============================================

/**
 * GET /api/compras/ordenes/alta
 * Los tickets en Compras que esperan su orden. Antes lee de osTicket a quién
 * está asignado cada uno (si la última lectura tiene más de un minuto).
 */
const getPorDarDeAlta = catchAsync(async (req, res) => {
  let aviso = null;
  try {
    await asignados.actualizarSiHaceFalta();
  } catch (e) {
    aviso = `No se pudo leer de osTicket a quién está asignado cada ticket; se muestra lo último que se leyó (${e.message}).`;
  }
  const { alcance, solicitudes } = await Orden.porDarDeAlta(req.usuario);
  sendSuccess(res, 200, { solicitudes, todas: alcance.todas, darDeAlta: alcance.crear, aviso });
});

/** GET /api/compras/ordenes/alta/:solicitudId */
const getParaAlta = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Orden.paraAlta(idDe(req.params.solicitudId), req.usuario));
});

/** GET /api/compras/ordenes/alta/:solicitudId/archivos/:archivoId */
const getArchivoSolicitud = catchAsync(async (req, res) => {
  mandarArchivo(req, res, await Orden.archivoDeSolicitud(idDe(req.params.solicitudId), idDe(req.params.archivoId), req.usuario));
});

/**
 * POST /api/compras/ordenes/alta/:solicitudId
 * multipart: proveedor, monto (sin IVA), moneda, comentario, archivos[] (la cotización, obligatoria)
 */
const postAlta = catchAsync(async (req, res) => {
  const files = req.files || [];
  try {
    const demasiado = archivosCompras.excedeTotal(files);
    if (demasiado) throw new AppError(demasiado, 400);
    const r = await Orden.darDeAlta(idDe(req.params.solicitudId), req.usuario, req.body || {}, archivosCompras.describir(files));
    await log(req, "CREATE", `Dio de alta la orden de compra de ${r.folio}`, r.id);
    avisos.enSegundoPlano(avisos.avisarOrden, r.solicitudId);
    sendSuccess(res, 201, r, `Orden de compra de ${r.folio} dada de alta. Ahora la firma el gerente del área.`);
  } catch (e) {
    archivosCompras.borrar(files);
    throw e;
  }
});

// =============================================
// DETALLE, FIRMAS Y PDF
// =============================================

/** GET /api/compras/ordenes/:id */
const getOrden = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Orden.obtener(idDe(req.params.id), req.usuario));
});

/** GET /api/compras/ordenes/:id/archivos/:archivoId — la cotización adjunta */
const getArchivo = catchAsync(async (req, res) => {
  mandarArchivo(req, res, await Orden.archivo(idDe(req.params.id), idDe(req.params.archivoId), req.usuario));
});

/**
 * GET /api/compras/ordenes/:id/pdf
 * El formato de autorización con las firmas estampadas. ?descargar=1 lo baja como archivo.
 */
const getPdf = catchAsync(async (req, res) => {
  const o = await Orden.obtener(idDe(req.params.id), req.usuario);
  const pdf = await pdfOrden.generar(o);
  const nombre = `Orden de compra ${o.osticket_numero || o.folio}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.descargar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nombre)}`,
  );
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(pdf);
});

/** POST /api/compras/ordenes/:id/firmar   { pin, tipo?, cuenta?, centroCostos?, comentario? } */
const postFirmar = catchAsync(async (req, res) => {
  const r = await Orden.firmar(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "UPDATE", `Firmó por ${PASO[r.paso]} la orden de compra de ${r.folio}${r.autorizada ? " (quedó autorizada)" : ""}`, r.id);
  avisos.enSegundoPlano(avisos.avisarOrden, r.solicitudId);
  sendSuccess(
    res,
    200,
    r,
    r.autorizada ? "Firmado. La orden de compra quedó autorizada." : `Firmado. Ahora firma ${PASO[r.siguiente]}.`,
  );
});

/** POST /api/compras/ordenes/:id/rechazar   { motivo } */
const postRechazar = catchAsync(async (req, res) => {
  const r = await Orden.rechazar(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "UPDATE", `Rechazó (como ${PASO[r.paso]}) la orden de compra de ${r.folio}`, r.id);
  avisos.enSegundoPlano(avisos.avisarOrden, r.solicitudId);
  sendSuccess(res, 200, r, "Orden de compra rechazada. Se le avisó a quien la pidió y a Compras.");
});

/** GET /api/compras/ordenes/firmantes */
const getFirmantes = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Orden.firmantes());
});

/** PUT /api/compras/ordenes/firmantes   { COMPRAS: [ids], FINANZAS: [ids], DIRECCION: [ids], montoMinimo } */
const putFirmantes = catchAsync(async (req, res) => {
  const r = await Orden.guardarFirmantes(req.body || {}, req.usuario.id);
  await log(req, "UPDATE", "Cambió quiénes firman las órdenes de compra", null);
  sendSuccess(res, 200, r, "Firmantes guardados");
});

module.exports = {
  getOrdenes,
  getPorDarDeAlta,
  getParaAlta,
  getArchivoSolicitud,
  postAlta,
  getOrden,
  getArchivo,
  getPdf,
  postFirmar,
  postRechazar,
  getFirmantes,
  putFirmantes,
};
