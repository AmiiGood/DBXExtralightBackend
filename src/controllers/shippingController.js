const PurchaseOrder = require("../models/PurchaseOrder");
const Carton = require("../models/Carton");
const ShippingImport = require("../models/ShippingImport");
const { parseShippingExcel } = require("../utils/excelShippingParser");
const {
  validateShippingData,
  identificarTipoCartones,
  validateCartonConsistency,
} = require("../utils/shippingValidations");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");
const fs = require("fs");

// =============================================
// IMPORTACIÓN DE POs Y CARTONES
// =============================================

/**
 * Importar POs y Cartones desde Excel
 */
const importarExcel = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError("Se requiere un archivo Excel", 400));
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname;

  try {
    // 1. Parsear el archivo Excel
    console.log("📄 Parseando archivo Excel...");
    const {
      pos,
      cartones,
      errores: erroresParser,
    } = parseShippingExcel(filePath);

    if (erroresParser.length > 0) {
      console.warn("⚠️ Errores al parsear:", erroresParser.length);
    }

    if (pos.length === 0) {
      throw new AppError("No se encontraron POs válidas en el archivo", 400);
    }

    if (cartones.length === 0) {
      throw new AppError(
        "No se encontraron Cartones válidos en el archivo",
        400,
      );
    }

    // 2. Validar consistencia de cartones
    console.log("🔍 Validando consistencia de cartones...");
    const validacionConsistencia = validateCartonConsistency(cartones);
    if (!validacionConsistencia.valido) {
      return next(
        new AppError(
          `Errores de consistencia en cartones: ${JSON.stringify(validacionConsistencia.errores)}`,
          400,
        ),
      );
    }

    // 3. Identificar tipo de cartones (MONO o MUSICAL)
    console.log("🎵 Identificando tipos de cartones...");
    const cartonesConTipo = identificarTipoCartones(cartones);

    // 4. Validar que los totales cuadren
    console.log("🧮 Validando totales...");
    const validacion = validateShippingData(pos, cartonesConTipo);

    if (!validacion.valido) {
      // Registrar importación fallida
      await ShippingImport.create({
        nombreArchivo: fileName,
        totalPos: pos.length,
        posCreadas: 0,
        totalCartones: cartonesConTipo.length,
        cartonesCreados: 0,
        errores: [...erroresParser, ...validacion.errores],
        importadoPor: req.usuario.id,
      });

      return next(
        new AppError(
          `Los datos no cuadran: ${JSON.stringify(validacion.errores)}`,
          400,
        ),
      );
    }

    // 5. Insertar POs en la base de datos
    console.log("💾 Insertando POs en la base de datos...");
    const { created: posCreadas, errors: erroresPos } =
      await PurchaseOrder.bulkCreate(pos);

    // 6. Crear un mapa de PO Number -> PO ID
    const posMap = {};
    posCreadas.forEach((po) => {
      posMap[po.po_number] = po.id;
    });

    // 7. Asociar cartones con sus POs y insertar
    console.log("📦 Insertando Cartones en la base de datos...");
    const cartonesConPoId = cartonesConTipo.map((carton) => ({
      ...carton,
      poId: posMap[carton.poNumber],
    }));

    // Filtrar cartones cuya PO fue creada exitosamente
    const cartonesValidos = cartonesConPoId.filter((c) => c.poId);

    const { created: cartonesCreados, errors: erroresCartones } =
      await Carton.bulkCreate(cartonesValidos);

    // 8. Registrar la importación
    const todosLosErrores = [
      ...erroresParser,
      ...erroresPos.map((e) => ({ tipo: "PO_INSERT", ...e })),
      ...erroresCartones.map((e) => ({ tipo: "CARTON_INSERT", ...e })),
    ];

    const importRecord = await ShippingImport.create({
      nombreArchivo: fileName,
      totalPos: pos.length,
      posCreadas: posCreadas.length,
      totalCartones: cartonesConTipo.length,
      cartonesCreados: cartonesCreados.length,
      errores: todosLosErrores.length > 0 ? todosLosErrores : null,
      importadoPor: req.usuario.id,
    });

    // 9. Log de auditoría
    await registrarLog({
      usuarioId: req.usuario.id,
      accion: "IMPORT_SHIPPING",
      modulo: "Embarque - Importación",
      tablaAfectada: "purchase_orders,cartones",
      registroId: importRecord.id,
      descripcion: `Excel importado: ${fileName} - ${posCreadas.length} POs, ${cartonesCreados.length} cartones`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
      datosNuevos: {
        archivo: fileName,
        totalPos: pos.length,
        posCreadas: posCreadas.length,
        totalCartones: cartonesConTipo.length,
        cartonesCreados: cartonesCreados.length,
        errores: todosLosErrores.length,
      },
    });

    // 10. Limpiar archivo temporal
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error("Error al eliminar archivo temporal:", e);
    }

    // 11. Responder
    sendSuccess(
      res,
      200,
      {
        importacion: {
          id: importRecord.id,
          archivo: fileName,
          pos: {
            total: pos.length,
            creadas: posCreadas.length,
            errores: erroresPos.length,
          },
          cartones: {
            total: cartonesConTipo.length,
            creados: cartonesCreados.length,
            errores: erroresCartones.length,
          },
          errores: todosLosErrores.length > 0 ? todosLosErrores : null,
          resumen: validacion.resumen,
        },
      },
      `Importación completada: ${posCreadas.length} POs y ${cartonesCreados.length} cartones`,
    );
  } catch (error) {
    // Limpiar archivo en caso de error
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error("Error al eliminar archivo temporal:", e);
    }

    throw error;
  }
});

/**
 * Obtener historial de importaciones
 */
const getHistorialImportaciones = catchAsync(async (req, res, next) => {
  const { limit = 20 } = req.query;

  const importaciones = await ShippingImport.findAll(parseInt(limit));

  sendSuccess(res, 200, { importaciones });
});

/**
 * Obtener detalles de una importación específica
 */
const getImportacionById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const importacion = await ShippingImport.findById(id);

  if (!importacion) {
    return next(new AppError("Importación no encontrada", 404));
  }

  sendSuccess(res, 200, { importacion });
});

// =============================================
// CONSULTA DE POs
// =============================================

/**
 * Obtener todas las POs con filtros
 */
const getPOs = catchAsync(async (req, res, next) => {
  const {
    estado,
    poNumber,
    fechaInicio,
    fechaFin,
    limit = 50,
    offset = 0,
  } = req.query;

  const filters = {
    estado,
    poNumber,
    fechaInicio,
    fechaFin,
    limit: parseInt(limit),
    offset: parseInt(offset),
  };

  const [pos, total] = await Promise.all([
    PurchaseOrder.findAll(filters),
    PurchaseOrder.count(filters),
  ]);

  sendSuccess(res, 200, {
    pos,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener una PO por ID con sus cartones
 */
const getPoById = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const po = await PurchaseOrder.findByIdWithCartones(id);

  if (!po) {
    return next(new AppError("PO no encontrada", 404));
  }

  sendSuccess(res, 200, { po });
});

/**
 * Obtener estadísticas de una PO
 */
const getPoEstadisticas = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  const estadisticas = await PurchaseOrder.getEstadisticas(id);

  if (!estadisticas) {
    return next(new AppError("PO no encontrada", 404));
  }

  sendSuccess(res, 200, { estadisticas });
});

// =============================================
// CONSULTA DE CARTONES
// =============================================

/**
 * Obtener cartones de una PO
 */
const getCartonesByPo = catchAsync(async (req, res, next) => {
  const { poId } = req.params;
  const { tipo, estado } = req.query;

  const cartones = await Carton.findByPoId(poId, { tipo, estado });

  sendSuccess(res, 200, { cartones, total: cartones.length });
});

/**
 * Obtener información de un cartón por CartonID
 */
const getCartonInfo = catchAsync(async (req, res, next) => {
  const { cartonId } = req.params;

  const cartonInfo = await Carton.getCartonInfo(cartonId);

  if (!cartonInfo) {
    return next(new AppError("Cartón no encontrado", 404));
  }

  sendSuccess(res, 200, { carton: cartonInfo });
});

/**
 * Verificar si un cartón es MUSICAL
 */
const checkCartonTipo = catchAsync(async (req, res, next) => {
  const { cartonId } = req.params;

  const isMusicale = await Carton.isMusicale(cartonId);
  const cartones = await Carton.findByNumeroCarton(cartonId);

  if (cartones.length === 0) {
    return next(new AppError("Cartón no encontrado", 404));
  }

  sendSuccess(res, 200, {
    cartonId,
    tipo: isMusicale ? "MUSICAL" : "MONO",
    skus: cartones.map((c) => ({
      sku: c.sku,
      cantidad: c.cantidad_pares_esperados,
      estado: c.estado,
    })),
  });
});

// =============================================
// DASHBOARD
// =============================================

/**
 * Obtener resumen del módulo de embarque
 */
const getDashboard = catchAsync(async (req, res, next) => {
  const [totalPos, posPendientes, posEnProceso, posCompletadas] =
    await Promise.all([
      PurchaseOrder.count({}),
      PurchaseOrder.count({ estado: "PENDIENTE" }),
      PurchaseOrder.count({ estado: "EN_PRODUCCION" }),
      PurchaseOrder.count({ estado: "COMPLETADA" }),
    ]);

  const ultimaImportacion = await ShippingImport.getUltimaImportacion();
  const estadisticasImportaciones = await ShippingImport.getEstadisticas();

  sendSuccess(res, 200, {
    pos: {
      total: totalPos,
      pendientes: posPendientes,
      enProceso: posEnProceso,
      completadas: posCompletadas,
    },
    ultimaImportacion: ultimaImportacion
      ? {
          fecha: ultimaImportacion.creado_en,
          archivo: ultimaImportacion.nombre_archivo,
          posCreadas: ultimaImportacion.pos_creadas,
          cartonesCreados: ultimaImportacion.cartones_creados,
        }
      : null,
    importaciones: estadisticasImportaciones,
  });
});

module.exports = {
  // Importación
  importarExcel,
  getHistorialImportaciones,
  getImportacionById,
  // POs
  getPOs,
  getPoById,
  getPoEstadisticas,
  // Cartones
  getCartonesByPo,
  getCartonInfo,
  checkCartonTipo,
  // Dashboard
  getDashboard,
};
