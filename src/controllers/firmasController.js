const Firma = require("../models/Firma");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

/**
 * Mi firma: cada usuario registra la suya y prueba su PIN. No pide módulo:
 * cualquiera que vaya a firmar algo la necesita. Ver models/Firma.js.
 */

function log(req, accion, descripcion) {
  return registrarLog({
    usuarioId: req.usuario.id,
    accion,
    modulo: "Firmas",
    tablaAfectada: "usuarios_firmas",
    descripcion,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
}

function exigirAdmin(req) {
  if (!req.usuario.rol?.esAdmin) throw new AppError("Solo el administrador puede ver y quitar firmas", 403);
}

/** GET /api/firmas/mia */
const getMia = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { ...(await Firma.mia(req.usuario.id)), esAdmin: Boolean(req.usuario.rol?.esAdmin) });
});

/** POST /api/firmas/mia   { imagen (data URL PNG), pin, password } */
const postMia = catchAsync(async (req, res) => {
  const r = await Firma.registrar(req.usuario.id, req.body || {});
  await log(req, r.cambio ? "UPDATE" : "CREATE", r.cambio ? "Cambió su firma y su PIN" : "Registró su firma");
  sendSuccess(res, 201, r, r.cambio ? "Firma cambiada" : "Firma registrada");
});

/** POST /api/firmas/probar   { pin } — revisa el PIN sin firmar nada */
const postProbar = catchAsync(async (req, res) => {
  await Firma.verificar(req.usuario.id, req.body?.pin);
  sendSuccess(res, 200, { ok: true }, "El PIN es correcto");
});

/** GET /api/firmas — admin: quién tiene firma */
const getTodas = catchAsync(async (req, res) => {
  exigirAdmin(req);
  sendSuccess(res, 200, await Firma.listar());
});

/** DELETE /api/firmas/usuario/:id — admin: quitar la firma de alguien */
const deleteDeUsuario = catchAsync(async (req, res) => {
  exigirAdmin(req);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Usuario inválido", 400);
  await Firma.quitar(id, req.usuario.id);
  await log(req, "DELETE", `Quitó la firma del usuario #${id}`);
  sendSuccess(res, 200, { usuarioId: id }, "Firma quitada; esa persona tendrá que registrarla de nuevo");
});

module.exports = { getMia, postMia, postProbar, getTodas, deleteDeUsuario };
