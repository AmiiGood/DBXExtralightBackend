const EnvioReportes = require("../models/EnvioReportes");
const planificador = require("../services/planificador.service");
const { ejecutarProgramacion } = require("../services/envioReportes.service");
const correo = require("../services/correo.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

const MODULO = "Envío de Reportes";

/** El planificador vive en memoria: hay que avisarle de cualquier cambio. */
async function recargarPlanificador() {
  try {
    return await planificador.recargar();
  } catch (e) {
    console.error("⚠️  No se pudo recargar el planificador:", e.message);
    return null;
  }
}

// =============================================
// LISTAS DE CORREO
// =============================================

const getListas = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { listas: await EnvioReportes.getListas() });
});

const getLista = catchAsync(async (req, res, next) => {
  const lista = await EnvioReportes.getLista(parseInt(req.params.id, 10));
  if (!lista) return next(new AppError("La lista no existe", 404));
  sendSuccess(res, 200, lista);
});

const crearLista = catchAsync(async (req, res, next) => {
  try {
    const lista = await EnvioReportes.crearLista(req.body, req.usuario.id);
    await registrarLog({
      usuarioId: req.usuario.id,
      accion: "INSERT",
      modulo: MODULO,
      tablaAfectada: "listas_correo",
      registroId: lista.id,
      descripcion: `Lista de correo creada: ${lista.nombre}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });
    sendSuccess(res, 201, lista, "Lista creada");
  } catch (e) {
    if (e.code === "23505") {
      return next(new AppError("Ya existe una lista con ese nombre", 409));
    }
    throw e;
  }
});

const actualizarLista = catchAsync(async (req, res, next) => {
  const lista = await EnvioReportes.actualizarLista(
    parseInt(req.params.id, 10),
    req.body,
  );
  if (!lista) return next(new AppError("La lista no existe", 404));
  // Desactivar una lista debe apagar sus programaciones
  await recargarPlanificador();
  sendSuccess(res, 200, lista, "Lista actualizada");
});

const eliminarLista = catchAsync(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const lista = await EnvioReportes.getLista(id);
  const ok = await EnvioReportes.eliminarLista(id);
  if (!ok) return next(new AppError("La lista no existe", 404));
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "DELETE",
    modulo: MODULO,
    tablaAfectada: "listas_correo",
    registroId: id,
    descripcion: `Lista de correo eliminada: ${lista?.nombre || id}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, { id }, "Lista eliminada");
});

// =============================================
// MIEMBROS
// =============================================

const agregarMiembro = catchAsync(async (req, res) => {
  const miembro = await EnvioReportes.agregarMiembro(
    parseInt(req.params.id, 10),
    req.body,
  );
  sendSuccess(res, 201, miembro, "Destinatario agregado");
});

const actualizarMiembro = catchAsync(async (req, res, next) => {
  const m = await EnvioReportes.actualizarMiembro(
    parseInt(req.params.miembroId, 10),
    req.body,
  );
  if (!m) return next(new AppError("El destinatario no existe", 404));
  sendSuccess(res, 200, m, "Destinatario actualizado");
});

const eliminarMiembro = catchAsync(async (req, res, next) => {
  const ok = await EnvioReportes.eliminarMiembro(
    parseInt(req.params.miembroId, 10),
  );
  if (!ok) return next(new AppError("El destinatario no existe", 404));
  sendSuccess(res, 200, {}, "Destinatario eliminado");
});

// =============================================
// PROGRAMACIONES
// =============================================

const getProgramaciones = catchAsync(async (req, res) => {
  const programaciones = await EnvioReportes.getProgramaciones();
  sendSuccess(res, 200, {
    programaciones,
    // Lo que el planificador tiene montado ahora mismo, para poder detectar
    // desfases entre lo guardado y lo que realmente va a correr
    planificador: planificador.estado(),
  });
});

const crearProgramacion = catchAsync(async (req, res) => {
  const prog = await EnvioReportes.crearProgramacion(req.body, req.usuario.id);
  const activas = await recargarPlanificador();
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "INSERT",
    modulo: MODULO,
    tablaAfectada: "reportes_programados",
    registroId: prog.id,
    descripcion: `Programación creada: ${prog.nombre} (${prog.expresion_cron})`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 201, { ...prog, activas }, "Programación creada");
});

const actualizarProgramacion = catchAsync(async (req, res, next) => {
  const prog = await EnvioReportes.actualizarProgramacion(
    parseInt(req.params.id, 10),
    req.body,
  );
  if (!prog) return next(new AppError("La programación no existe", 404));
  const activas = await recargarPlanificador();
  sendSuccess(res, 200, { ...prog, activas }, "Programación actualizada");
});

const eliminarProgramacion = catchAsync(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const ok = await EnvioReportes.eliminarProgramacion(id);
  if (!ok) return next(new AppError("La programación no existe", 404));
  await recargarPlanificador();
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "DELETE",
    modulo: MODULO,
    tablaAfectada: "reportes_programados",
    registroId: id,
    descripcion: `Programación eliminada (id ${id})`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, { id }, "Programación eliminada");
});

/**
 * POST /:id/probar
 * Ejecuta la programación al instante, sin esperar a su horario.
 *
 * @body { soloAMi: true }  manda solo al correo de quien lo pide, para no
 *                          molestar a toda la lista mientras se prueba
 */
const probarProgramacion = catchAsync(async (req, res, next) => {
  const prog = await EnvioReportes.getProgramacion(parseInt(req.params.id, 10));
  if (!prog) return next(new AppError("La programación no existe", 404));

  const soloA = req.body?.soloAMi && req.usuario.email ? [req.usuario.email] : null;

  const resultado = await ejecutarProgramacion(prog, {
    disparo: "MANUAL",
    usuarioId: req.usuario.id,
    soloA,
  });

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "ENVIO",
    modulo: MODULO,
    tablaAfectada: "reportes_envios",
    registroId: prog.id,
    descripcion:
      `Prueba de "${prog.nombre}": ` +
      (resultado.ok
        ? `enviado a ${resultado.destinatarios.length} destinatario(s)`
        : `error — ${resultado.error}`),
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });

  if (!resultado.ok) {
    return next(new AppError(resultado.error, 400));
  }
  sendSuccess(res, 200, resultado, "Reporte enviado");
});

// =============================================
// BITÁCORA Y DIAGNÓSTICO
// =============================================

const getEnvios = catchAsync(async (req, res) => {
  const envios = await EnvioReportes.getEnvios({
    programadoId: req.query.programadoId
      ? parseInt(req.query.programadoId, 10)
      : undefined,
    limite: Math.min(parseInt(req.query.limite, 10) || 50, 200),
  });
  sendSuccess(res, 200, { envios });
});

/** Comprueba que el servidor de correo responda, antes de programar nada. */
const probarConexion = catchAsync(async (req, res, next) => {
  try {
    sendSuccess(res, 200, await correo.verificar(), "Conexión correcta");
  } catch (e) {
    return next(
      new AppError(`No se pudo conectar al servidor de correo: ${e.message}`, 502),
    );
  }
});

module.exports = {
  getListas,
  getLista,
  crearLista,
  actualizarLista,
  eliminarLista,
  agregarMiembro,
  actualizarMiembro,
  eliminarMiembro,
  getProgramaciones,
  crearProgramacion,
  actualizarProgramacion,
  eliminarProgramacion,
  probarProgramacion,
  getEnvios,
  probarConexion,
};
