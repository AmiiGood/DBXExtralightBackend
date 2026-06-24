const QrUpcMapping = require("../models/QrUpcMapping");
const ProductoCrocs = require("../models/ProductoCrocs");
const QrEscaneo = require("../models/QrEscaneo");
const QrSincronizacion = require("../models/QrSincronizacion");
const QrCargaExcel = require("../models/QrCargaExcel");
const Turno = require("../models/Turno");
const { normalizarQR, normalizarQrDesdeApi } = require("../utils/qrNormalizer");
const { fetchQrUpcMappings } = require("../utils/tusApiClient");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");

// =============================================
// ESCANEO Y VALIDACIÓN QR (flujo principal)
// =============================================

/**
 * Escanear / validar un código QR
 * 1. Normaliza el código QR
 * 2. Busca en qr_upc_mapping el UPC asociado
 * 3. Busca en productos_crocs la info del producto
 * 4. Registra el escaneo en historial
 */
const escanearQr = catchAsync(async (req, res, next) => {
  const { qrCode } = req.body;

  if (!qrCode || typeof qrCode !== "string" || qrCode.trim() === "") {
    return next(new AppError("El código QR es requerido", 400));
  }

  const qrRaw = qrCode.trim();
  const qrNormalizado = normalizarQR(qrRaw);

  if (!qrNormalizado) {
    return next(new AppError("No se pudo procesar el código QR", 400));
  }

  // Buscar el QR en los mapeos sincronizados
  const mapping = await QrUpcMapping.findByQrNormalizado(qrNormalizado);

  let upcEncontrado = null;
  let productos = [];
  let productoEncontrado = false;

  if (mapping) {
    upcEncontrado = mapping.upc;

    // Buscar información del producto por UPC
    productos = await ProductoCrocs.findByUpc(mapping.upc);
    productoEncontrado = productos.length > 0;
  }

  // Obtener turno actual
  let turnoId = null;
  try {
    turnoId = await Turno.getCurrentShift();
  } catch (e) {
    // No es crítico si no se obtiene el turno
  }

  // Construir resultado
  const resultado = {
    qrNormalizado,
    qrEncontrado: !!mapping,
    upc: upcEncontrado,
    productoEncontrado,
    productos: productos.map((p) => ({
      sku: p.sku,
      upc: p.upc,
      styleNo: p.style_no,
      styleName: p.style_name,
      color: p.color,
      size: p.size,
    })),
  };

  // Registrar el escaneo
  const escaneo = await QrEscaneo.create({
    qrRaw,
    qrNormalizado,
    upcEncontrado,
    productoEncontrado,
    resultado,
    escaneadoPor: req.usuario.id,
    turnoId,
  });

  // Log
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "QR_SCAN",
    modulo: "Validación QR",
    tablaAfectada: "qr_escaneos",
    registroId: escaneo.id,
    descripcion: `QR escaneado: ${qrNormalizado} → UPC: ${upcEncontrado || "NO ENCONTRADO"}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: resultado,
  });

  sendSuccess(
    res,
    200,
    { escaneo: resultado },
    productoEncontrado
      ? "Producto encontrado"
      : "QR no encontrado en el catálogo",
  );
});

// =============================================
// SINCRONIZACIÓN CON API TUS
// =============================================

/**
 * Sincronizar mapeos QR→UPC desde la API de TUS
 */
const sincronizarTus = catchAsync(async (req, res, next) => {
  const { lastGetTime } = req.body;

  // Determinar la fecha de última sincronización
  let fechaConsulta;
  if (lastGetTime) {
    fechaConsulta = lastGetTime;
  } else {
    // Intentar obtener la última sincronización exitosa
    const ultima = await QrSincronizacion.getUltimaSincronizacion();
    if (ultima) {
      fechaConsulta = ultima.last_get_time;
    } else {
      // Primera vez: usar una fecha antigua
      fechaConsulta = "2024-01-01 00:00:00";
    }
  }

  let syncRecord;
  try {
    // Llamar a la API de TUS
    const mappingsRaw = await fetchQrUpcMappings(fechaConsulta);

    // Normalizar y preparar para inserción
    const mappingsNormalizados = mappingsRaw.map((m) => ({
      qrCode: m.QrCode,
      qrNormalizado: normalizarQrDesdeApi(m.QrCode),
      upc: m.UPC,
    }));

    // Insertar en la BD
    const { insertados, existentes } =
      await QrUpcMapping.bulkUpsert(mappingsNormalizados);

    // Registrar la sincronización
    syncRecord = await QrSincronizacion.create({
      fechaConsulta: new Date(),
      lastGetTime: fechaConsulta,
      totalRegistros: mappingsRaw.length,
      nuevosRegistros: insertados,
      estado: "success",
      ejecutadoPor: req.usuario.id,
    });

    // Log
    await registrarLog({
      usuarioId: req.usuario.id,
      accion: "QR_SYNC",
      modulo: "Validación QR",
      tablaAfectada: "qr_upc_mapping",
      descripcion: `Sincronización TUS: ${mappingsRaw.length} recibidos, ${insertados} nuevos, ${existentes} existentes`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
      datosNuevos: {
        lastGetTime: fechaConsulta,
        totalRecibidos: mappingsRaw.length,
        insertados,
        existentes,
      },
    });

    const totalMapeos = await QrUpcMapping.count();

    sendSuccess(
      res,
      200,
      {
        sincronizacion: {
          totalRecibidos: mappingsRaw.length,
          nuevosInsertados: insertados,
          yaExistentes: existentes,
          totalMapeosEnBD: totalMapeos,
          lastGetTime: fechaConsulta,
        },
      },
      `Sincronización completada: ${insertados} nuevos mapeos de ${mappingsRaw.length} recibidos`,
    );
  } catch (error) {
    // Registrar fallo
    await QrSincronizacion.create({
      fechaConsulta: new Date(),
      lastGetTime: fechaConsulta,
      estado: "error",
      errorMensaje: error.message,
      ejecutadoPor: req.usuario.id,
    });

    return next(
      new AppError(`Error al sincronizar con TUS: ${error.message}`, 500),
    );
  }
});

/**
 * Obtener historial de sincronizaciones
 */
const getHistorialSincronizaciones = catchAsync(async (req, res, next) => {
  const { limit = 20 } = req.query;
  const sincronizaciones = await QrSincronizacion.findAll(parseInt(limit));
  const totalMapeos = await QrUpcMapping.count();

  sendSuccess(res, 200, { sincronizaciones, totalMapeos });
});

// =============================================
// CARGA DE EXCEL CON PRODUCTOS
// =============================================

/**
 * Cargar archivo Excel con catálogo de productos
 * Espera columnas: SKU, UPC, StyleNo, StyleName, Color, Size
 */
const cargarExcel = catchAsync(async (req, res, next) => {
  if (!req.file) {
    return next(new AppError("Se requiere un archivo Excel", 400));
  }

  const XLSX = require("xlsx");

  // Leer el archivo
  const workbook = XLSX.readFile(req.file.path);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (data.length === 0) {
    return next(new AppError("El archivo Excel está vacío", 400));
  }

  // Mapear las columnas (ser flexible con nombres)
  const productos = data.map((row) => {
    // Buscar las columnas de forma flexible (case-insensitive)
    const keys = Object.keys(row);
    const findKey = (names) =>
      keys.find((k) => names.includes(k.toLowerCase().trim()));

    const skuKey = findKey(["sku", "sku_code"]);
    const upcKey = findKey(["upc", "upc_code", "barcode"]);
    const styleNoKey = findKey(["styleno", "style_no", "style no", "style"]);
    const styleNameKey = findKey([
      "stylename",
      "style_name",
      "style name",
      "nombre",
    ]);
    const colorKey = findKey(["color", "colour"]);
    const sizeKey = findKey(["size", "talla", "sizes"]);

    return {
      sku: skuKey ? String(row[skuKey]).trim() : "",
      upc: upcKey ? String(row[upcKey]).trim() : "",
      styleNo: styleNoKey ? String(row[styleNoKey]).trim() : "",
      styleName: styleNameKey ? String(row[styleNameKey]).trim() : "",
      color: colorKey ? String(row[colorKey]).trim() : "",
      size: sizeKey ? String(row[sizeKey]).trim() : "",
    };
  });

  // Filtrar filas sin SKU o UPC
  const productosValidos = productos.filter((p) => p.sku && p.upc);

  if (productosValidos.length === 0) {
    return next(
      new AppError(
        "No se encontraron registros válidos. Asegúrate de que el Excel tenga columnas SKU y UPC",
        400,
      ),
    );
  }

  // Insertar/actualizar en BD
  const { nuevos, actualizados, errores } =
    await ProductoCrocs.bulkUpsert(productosValidos);

  // Registrar la carga
  const cargaRecord = await QrCargaExcel.create({
    nombreArchivo: req.file.originalname,
    totalRegistros: data.length,
    registrosNuevos: nuevos,
    registrosActualizados: actualizados,
    registrosError: errores,
    cargadoPor: req.usuario.id,
  });

  // Log
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "EXCEL_UPLOAD",
    modulo: "Validación QR",
    tablaAfectada: "productos_crocs",
    registroId: cargaRecord.id,
    descripcion: `Excel cargado: ${req.file.originalname} - ${nuevos} nuevos, ${actualizados} actualizados`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: {
      archivo: req.file.originalname,
      totalFilas: data.length,
      nuevos,
      actualizados,
      errores,
    },
  });

  // Limpiar archivo temporal
  const fs = require("fs");
  try {
    fs.unlinkSync(req.file.path);
  } catch (e) {
    /* no crítico */
  }

  sendSuccess(
    res,
    200,
    {
      carga: {
        archivo: req.file.originalname,
        totalFilas: data.length,
        productosValidos: productosValidos.length,
        nuevos,
        actualizados,
        errores,
      },
    },
    `Carga completada: ${nuevos} nuevos, ${actualizados} actualizados`,
  );
});

/**
 * Obtener historial de cargas de Excel
 */
const getHistorialCargas = catchAsync(async (req, res, next) => {
  const { limit = 20 } = req.query;
  const cargas = await QrCargaExcel.findAll(parseInt(limit));
  const totalProductos = await ProductoCrocs.count({ activo: true });

  sendSuccess(res, 200, { cargas, totalProductos });
});

// =============================================
// CONSULTAS DE PRODUCTOS Y MAPEOS
// =============================================

/**
 * Obtener productos del catálogo
 */
const getProductos = catchAsync(async (req, res, next) => {
  const { search, upc, activo, limit = 50, offset = 0 } = req.query;

  const filters = {
    search,
    upc,
    limit: parseInt(limit),
    offset: parseInt(offset),
  };
  if (activo !== undefined) filters.activo = activo === "true";

  const [productos, total] = await Promise.all([
    ProductoCrocs.findAll(filters),
    ProductoCrocs.count(filters),
  ]);

  sendSuccess(res, 200, {
    productos,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener mapeos QR-UPC
 */
const getMapeos = catchAsync(async (req, res, next) => {
  const { search, upc, limit = 50, offset = 0 } = req.query;

  const filters = {
    search,
    upc,
    limit: parseInt(limit),
    offset: parseInt(offset),
  };

  const mapeos = await QrUpcMapping.findAll(filters);
  const total = await QrUpcMapping.count();

  sendSuccess(res, 200, {
    mapeos,
    pagination: { total, limit: filters.limit, offset: filters.offset },
  });
});

// =============================================
// HISTORIAL DE ESCANEOS
// =============================================

/**
 * Obtener historial de escaneos
 */
const getEscaneos = catchAsync(async (req, res, next) => {
  const {
    fechaInicio,
    fechaFin,
    escaneadoPor,
    productoEncontrado,
    upc,
    search,
    limit = 50,
    offset = 0,
  } = req.query;

  const filters = {
    fechaInicio,
    fechaFin,
    escaneadoPor: escaneadoPor ? parseInt(escaneadoPor) : undefined,
    upc,
    search,
    limit: parseInt(limit),
    offset: parseInt(offset),
  };

  if (productoEncontrado !== undefined) {
    filters.productoEncontrado = productoEncontrado === "true";
  }

  const [escaneos, total] = await Promise.all([
    QrEscaneo.findAll(filters),
    QrEscaneo.count(filters),
  ]);

  sendSuccess(res, 200, {
    escaneos,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener estadísticas de escaneos
 */
const getEstadisticas = catchAsync(async (req, res, next) => {
  const { fechaInicio, fechaFin } = req.query;

  if (!fechaInicio || !fechaFin) {
    return next(new AppError("Se requieren fechaInicio y fechaFin", 400));
  }

  const [estadisticas, resumenPorUpc] = await Promise.all([
    QrEscaneo.getEstadisticas(fechaInicio, fechaFin),
    QrEscaneo.getResumenPorUpc(fechaInicio, fechaFin),
  ]);

  const totalMapeos = await QrUpcMapping.count();
  const totalProductos = await ProductoCrocs.count({ activo: true });

  sendSuccess(res, 200, {
    estadisticas: {
      ...estadisticas,
      totalMapeos,
      totalProductos,
    },
    resumenPorUpc,
  });
});

/**
 * Obtener resumen general del módulo (para dashboard)
 */
const getDashboard = catchAsync(async (req, res, next) => {
  const totalMapeos = await QrUpcMapping.count();
  const totalProductos = await ProductoCrocs.count({ activo: true });
  const ultimaSinc = await QrSincronizacion.getUltimaSincronizacion();

  // Estadísticas de hoy
  const hoy = new Date();
  const inicioHoy = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate(),
  ).toISOString();
  const finHoy = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate() + 1,
  ).toISOString();

  const estadisticasHoy = await QrEscaneo.getEstadisticas(inicioHoy, finHoy);

  sendSuccess(res, 200, {
    totalMapeos,
    totalProductos,
    ultimaSincronizacion: ultimaSinc
      ? {
          fecha: ultimaSinc.creado_en,
          totalRegistros: ultimaSinc.total_registros,
          nuevos: ultimaSinc.nuevos_registros,
        }
      : null,
    escanosHoy: estadisticasHoy,
  });
});

module.exports = {
  // Flujo principal
  escanearQr,
  // Sincronización TUS
  sincronizarTus,
  getHistorialSincronizaciones,
  // Excel
  cargarExcel,
  getHistorialCargas,
  // Consultas
  getProductos,
  getMapeos,
  // Escaneos
  getEscaneos,
  getEstadisticas,
  // Dashboard
  getDashboard,
};
