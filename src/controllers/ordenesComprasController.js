const Orden = require("../models/CompraOrden");
const avisos = require("../services/avisosCompras.service");
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

/** GET /api/compras/ordenes?vista=por-firmar|firmadas|todas */
const getOrdenes = catchAsync(async (req, res) => {
  const vista = req.query.vista || "por-firmar";
  const [ordenes, porFirmar, verTodas] = await Promise.all([
    Orden.listar(req.usuario, vista),
    Orden.contarPorFirmar(req.usuario),
    Orden.verTodas(req.usuario),
  ]);
  sendSuccess(res, 200, { vista, ordenes, porFirmar, verTodas });
});

/** GET /api/compras/ordenes/:id */
const getOrden = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Orden.obtener(idDe(req.params.id), req.usuario));
});

/** POST /api/compras/solicitudes/:id/orden   { comentario, pin? } */
const postEnviar = catchAsync(async (req, res) => {
  const r = await Orden.enviar(idDe(req.params.id), req.usuario, req.body || {});
  await log(req, "CREATE", `Envió la orden de compra de ${r.folio}${r.firmada ? " y la firmó como gerente" : ""}`, r.id);
  avisos.enSegundoPlano(avisos.avisarOrden, r.solicitudId);
  sendSuccess(
    res,
    201,
    r,
    r.firmada
      ? "Orden de compra enviada con tu firma de gerente. Ahora firma Compras."
      : "Orden de compra enviada. Ahora la firma el gerente de tu área.",
  );
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

module.exports = { getOrdenes, getOrden, postEnviar, postFirmar, postRechazar, getFirmantes, putFirmantes };
