const Presupuesto = require("../models/CompraPresupuesto");
const RolModulo = require("../models/RolModulo");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

function anioDe(valor) {
  const a = valor == null || valor === "" ? new Date().getFullYear() : parseInt(valor, 10);
  if (!Number.isInteger(a) || a < 2020 || a > 2100) throw new AppError("Año inválido", 400);
  return a;
}

/** GET /api/compras/presupuestos?anio=2026 — todas las áreas: presupuesto y ejercido por mes */
const getPresupuestos = catchAsync(async (req, res) => {
  const u = req.usuario;
  // La pantalla enseña la captura solo a quien puede guardarla
  const puedeEditar =
    Boolean(u.rol?.esAdmin) || (await RolModulo.verificarPermiso(u.rol?.id, "/compras/presupuestos", "puede_editar"));
  sendSuccess(res, 200, { ...(await Presupuesto.resumen(anioDe(req.query.anio))), puedeEditar });
});

/** GET /api/compras/presupuestos/:areaId/elecciones?anio=2026 — lo que se le descontó al área */
const getElecciones = catchAsync(async (req, res) => {
  const areaId = parseInt(req.params.areaId, 10);
  if (!Number.isInteger(areaId) || areaId <= 0) throw new AppError("Área inválida", 400);
  sendSuccess(res, 200, await Presupuesto.elecciones(areaId, anioDe(req.query.anio)));
});

/** PUT /api/compras/presupuestos/:anio   { filas: [{ areaId, meses: [12] }] } */
const putPresupuestos = catchAsync(async (req, res) => {
  const anio = anioDe(req.params.anio);
  const r = await Presupuesto.guardar(anio, req.body?.filas, req.usuario.id);
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Presupuestos de Compras",
    tablaAfectada: "compras_presupuestos",
    descripcion: `Presupuestos ${anio}: ${r.cambios} meses cambiados`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, r, r.cambios ? `Presupuesto ${anio} guardado` : "No había cambios");
});

module.exports = { getPresupuestos, getElecciones, putPresupuestos };
