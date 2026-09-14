const ArticuloMassive = require("../models/ArticuloMassive");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

/**
 * GET /api/articulos-massive/catalogos
 * Todos los catálogos del módulo (colores, estilos, unfin, strap, tallas).
 */
const getCatalogos = catchAsync(async (req, res, next) => {
  const catalogos = await ArticuloMassive.getCatalogos();
  sendSuccess(res, 200, catalogos);
});

/**
 * POST /api/articulos-massive/productos/buscar
 * Buscar productos del Avery por lista de SKUs o por estilo + color.
 * @body { skus: ["10001-214-M2W4", ...] }  ó  { estilo: "10001", color: "214" }
 */
const buscarProductos = catchAsync(async (req, res, next) => {
  const { skus, estilo, color } = req.body;

  if (Array.isArray(skus) && skus.length > 0) {
    const limpios = [...new Set(skus.map((s) => String(s).trim()).filter(Boolean))];
    if (limpios.length === 0) {
      return next(new AppError("La lista de SKUs está vacía", 400));
    }
    if (limpios.length > 500) {
      return next(new AppError("Máximo 500 SKUs por búsqueda", 400));
    }
    const resultado = await ArticuloMassive.buscarPorSkus(limpios);
    return sendSuccess(res, 200, resultado);
  }

  if (estilo && color) {
    const productos = await ArticuloMassive.buscarPorEstiloColor(
      String(estilo).trim(),
      String(color).trim(),
    );
    return sendSuccess(res, 200, { productos, noEncontrados: [] });
  }

  return next(
    new AppError("Envía una lista de SKUs o un estilo y color a buscar", 400),
  );
});

/**
 * POST /api/articulos-massive/colores
 * Alta rápida de un color faltante en cat_colores.
 * @body { codigo: "30T", nombre: "Crocs Green" }
 */
const crearColor = catchAsync(async (req, res, next) => {
  const codigo = String(req.body.codigo || "").trim();
  const nombre = String(req.body.nombre || "").trim();

  if (!codigo || codigo.length > 10) {
    return next(new AppError("Código de color inválido (máximo 10 caracteres)", 400));
  }
  if (!nombre || nombre.length > 100) {
    return next(new AppError("Nombre de color inválido (máximo 100 caracteres)", 400));
  }

  const color = await ArticuloMassive.upsertColor(codigo, nombre);

  await registrarLog({
    usuarioId: req.usuario.id,
    accion: color.is_insert ? "CREATE" : "UPDATE",
    modulo: "Carga Masiva de Artículos",
    tablaAfectada: "cat_colores",
    descripcion: `Color ${color.is_insert ? "creado" : "actualizado"}: ${codigo} - ${nombre}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { codigo, nombre },
  });

  sendSuccess(res, color.is_insert ? 201 : 200, { color });
});

module.exports = {
  getCatalogos,
  buscarProductos,
  crearColor,
};
