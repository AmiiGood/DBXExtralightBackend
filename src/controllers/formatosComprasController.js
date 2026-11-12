const Formato = require("../models/CompraFormato");
const Catalogo = require("../models/CompraCatalogo");
const RolModulo = require("../models/RolModulo");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

const MODULO = "/compras/formatos";

/** Qué puede hacer el usuario en el módulo (el admin, todo). */
async function permisos(usuario) {
  const rol = usuario.rol || {};
  if (rol.esAdmin) return { crear: true, editar: true, eliminar: true };
  const [crear, editar, eliminar] = await Promise.all([
    RolModulo.verificarPermiso(rol.id, MODULO, "puede_crear"),
    RolModulo.verificarPermiso(rol.id, MODULO, "puede_editar"),
    RolModulo.verificarPermiso(rol.id, MODULO, "puede_eliminar"),
  ]);
  return { crear: Boolean(crear), editar: Boolean(editar), eliminar: Boolean(eliminar) };
}

function idDe(req) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Formato inválido", 400);
  return id;
}

const fechaValida = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s : null);

function log(req, accion, descripcion, tabla = "compras_formatos") {
  return registrarLog({
    usuarioId: req.usuario.id,
    accion,
    modulo: "Formatos de Compras",
    tablaAfectada: tabla,
    descripcion,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
}

const etiqueta = (f) => (f.ticket ? `ticket ${f.ticket}` : `formato #${f.id}`);

/** GET /api/compras/formatos?desde&hasta&areaId&moneda&estado&q */
const getFormatos = catchAsync(async (req, res) => {
  const q = req.query;
  const filas = await Formato.listar({
    desde: fechaValida(q.desde),
    hasta: fechaValida(q.hasta),
    areaId: parseInt(q.areaId, 10) || null,
    moneda: ["MXN", "USD"].includes(q.moneda) ? q.moneda : null,
    estado: ["completos", "pendientes"].includes(q.estado) ? q.estado : null,
    q: String(q.q || "").trim().slice(0, 100) || null,
  });
  sendSuccess(res, 200, { filas, permisos: await permisos(req.usuario), usuarioId: req.usuario.id });
});

/** GET /api/compras/formatos/opciones — áreas y sugerencias para la captura */
const getOpciones = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Formato.opciones());
});

/** POST /api/compras/formatos */
const postFormato = catchAsync(async (req, res) => {
  const f = await Formato.crear(req.body, req.usuario.id);
  await log(req, "CREATE", `Capturó el ${etiqueta(f)}`);
  sendSuccess(res, 201, f, "Formato capturado");
});

/**
 * PUT /api/compras/formatos/:id
 * Quien lo capturó lo corrige con solo poder crear; los de otros, con editar.
 */
const putFormato = catchAsync(async (req, res) => {
  const id = idDe(req);
  const actual = await Formato.obtener(id);
  const p = await permisos(req.usuario);
  if (!p.editar && !(p.crear && actual.capturado_por === req.usuario.id)) {
    throw new AppError("Solo puedes corregir los formatos que tú capturaste", 403);
  }
  const f = await Formato.actualizar(id, req.body, req.usuario.id);
  await log(req, "UPDATE", `Corrigió el ${etiqueta(f)}`);
  sendSuccess(res, 200, f, "Formato guardado");
});

/** DELETE /api/compras/formatos/:id */
const deleteFormato = catchAsync(async (req, res) => {
  const id = idDe(req);
  const borrado = await Formato.eliminar(id);
  await log(req, "DELETE", `Borró el ${etiqueta({ id, ticket: borrado.ticket })}`);
  sendSuccess(res, 200, { id }, "Formato borrado");
});

// ---------------------------------------------------------------------------
// Listas de tipos (Compras) y cuentas (Finanzas). Las mantiene quien puede
// corregir cualquier formato (editar) o el admin.
// ---------------------------------------------------------------------------

async function exigirEditar(req) {
  const p = await permisos(req.usuario);
  if (!p.editar) throw new AppError("Para cambiar las listas necesitas poder editar formatos", 403);
}

/** POST /api/compras/formatos/catalogos/tipos */
const postTipo = catchAsync(async (req, res) => {
  await exigirEditar(req);
  const t = await Catalogo.crearTipo(req.body, req.usuario.id);
  await log(req, "CREATE", `Agregó el tipo de compra "${t.nombre}"`, "compras_tipos");
  sendSuccess(res, 201, t, "Tipo agregado");
});

/** PUT /api/compras/formatos/catalogos/tipos/:id  { nombre, activo } */
const putTipo = catchAsync(async (req, res) => {
  await exigirEditar(req);
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Tipo inválido", 400);
  const t = await Catalogo.actualizarTipo(id, req.body, req.usuario.id);
  const cambio = t.anterior !== t.nombre ? ` (antes "${t.anterior}", ${t.formatos} formatos corregidos)` : "";
  await log(req, "UPDATE", `Cambió el tipo de compra "${t.nombre}"${cambio}${t.activo ? "" : ", inactivo"}`, "compras_tipos");
  sendSuccess(res, 200, t, "Tipo guardado");
});

/** POST /api/compras/formatos/catalogos/cuentas */
const postCuenta = catchAsync(async (req, res) => {
  await exigirEditar(req);
  const c = await Catalogo.crearCuenta(req.body, req.usuario.id);
  await log(req, "CREATE", `Agregó la cuenta ${c.codigo} ${c.nombre}`, "compras_cuentas");
  sendSuccess(res, 201, c, "Cuenta agregada");
});

/** PUT /api/compras/formatos/catalogos/cuentas/:codigo  { nombre, activo } */
const putCuenta = catchAsync(async (req, res) => {
  await exigirEditar(req);
  const c = await Catalogo.actualizarCuenta(req.params.codigo, req.body, req.usuario.id);
  await log(req, "UPDATE", `Cambió la cuenta ${c.codigo} ${c.nombre}${c.activo ? "" : ", inactiva"}`, "compras_cuentas");
  sendSuccess(res, 200, c, "Cuenta guardada");
});

module.exports = {
  getFormatos, getOpciones, postFormato, putFormato, deleteFormato,
  postTipo, putTipo, postCuenta, putCuenta,
};
