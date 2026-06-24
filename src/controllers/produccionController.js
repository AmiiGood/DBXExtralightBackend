const Caja = require("../models/Caja");
const QrEscaneo = require("../models/QrEscaneo");
const QrUpcMapping = require("../models/QrUpcMapping");
const ProductoCrocs = require("../models/ProductoCrocs");
const Turno = require("../models/Turno");
const { parseCaja } = require("../utils/cajaParser");
const { normalizarQR } = require("../utils/qrNormalizer");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
} = require("../utils/logger");
const db = require("../config/database");

// =============================================
// ESCANEO DE CAJAS
// =============================================

/**
 * Escanear código de caja (inicio del proceso o retomar caja existente)
 * Formato: 12345678$207013-410-C12$24$017
 *
 * Comportamiento:
 * - Si la caja NO existe → La crea (201 Created)
 * - Si la caja existe y está EN_PROCESO → La retoma (200 OK)
 * - Si la caja existe y está COMPLETADA/EMBARCADA → Error (400)
 */
const escanearCaja = catchAsync(async (req, res, next) => {
  const { codigoCaja } = req.body;

  // 1. Parsear el código de caja
  const resultado = parseCaja(codigoCaja);

  if (!resultado.valido) {
    return next(new AppError(resultado.error, 400));
  }

  const {
    codigoCaja: codigo,
    sku,
    cantidadPares,
    consecutivo,
    codigoCompleto,
  } = resultado;

  // 2. Verificar si la caja ya existe
  const cajaExistente = await Caja.findByCodigoCaja(codigo);

  if (cajaExistente) {
    // 2a. Si la caja existe y está EN_PROCESO, permitir retomar
    if (cajaExistente.estado === "EN_PROCESO") {
      const progreso = await Caja.getProgreso(cajaExistente.id);

      return sendSuccess(
        res,
        200,
        { caja: progreso },
        `Caja retomada. Faltan ${progreso.faltantes} códigos QR.`,
      );
    }

    // 2b. Si la caja está COMPLETADA o EMBARCADA, no permitir modificaciones
    if (cajaExistente.estado === "COMPLETADA") {
      return next(
        new AppError(
          `Esta caja ya está completada. No se pueden agregar más QRs.`,
          400,
        ),
      );
    }

    if (cajaExistente.estado === "EMBARCADA") {
      return next(
        new AppError(
          `Esta caja ya está embarcada. No se pueden agregar más QRs.`,
          400,
        ),
      );
    }
  }

  // 3. Obtener turno actual
  let turnoId = null;
  try {
    turnoId = await Turno.getCurrentShift();
  } catch (e) {
    console.warn("No se pudo obtener turno actual:", e.message);
  }

  // 4. Crear la caja (solo si no existe)
  const nuevaCaja = await Caja.create({
    codigoCaja: codigo,
    sku,
    cantidadPares,
    consecutivo,
    codigoCompleto,
    turnoId,
    escaneadoPor: req.usuario.id,
  });

  // 5. Registrar en logs
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "ESCANEAR_CAJA",
    modulo: "Producción",
    tablaAfectada: "cajas_produccion",
    registroId: nuevaCaja.id,
    descripcion: `Caja escaneada: ${codigo} - SKU: ${sku} - ${cantidadPares} pares`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
    datosNuevos: { codigo, sku, cantidadPares, consecutivo },
  });

  // 6. Obtener progreso
  const progreso = await Caja.getProgreso(nuevaCaja.id);

  sendSuccess(
    res,
    201,
    { caja: progreso },
    `Caja creada exitosamente. Escanea ${cantidadPares} códigos QR.`,
  );
});

// =============================================
// ESCANEO DE QRs
// =============================================

/**
 * Agregar QR a una caja
 */
const agregarQrACaja = catchAsync(async (req, res, next) => {
  const { cajaId } = req.params;
  const { qrCode } = req.body;

  // 1. Verificar que la caja existe
  const caja = await Caja.findById(cajaId);
  if (!caja) {
    return next(new AppError("Caja no encontrada", 404));
  }

  // 2. Verificar que la caja esté en proceso
  if (caja.estado !== "EN_PROCESO") {
    return next(
      new AppError(
        `Esta caja ya está en estado: ${caja.estado}. No se pueden agregar más QRs.`,
        400,
      ),
    );
  }

  // 3. Verificar que no esté completa
  const estaCompleta = await Caja.estaCompleta(cajaId);
  if (estaCompleta) {
    return next(
      new AppError("Esta caja ya tiene todos los QRs necesarios", 400),
    );
  }

  // 4. Normalizar el QR
  const qrNormalizado = normalizarQR(qrCode);
  if (!qrNormalizado) {
    return next(new AppError("No se pudo procesar el código QR", 400));
  }

  // 5. Verificar que el QR no haya sido escaneado antes
  const qrExistente = await QrUpcMapping.findByQrNormalizado(qrNormalizado);
  if (!qrExistente) {
    return next(
      new AppError(
        "Este código QR no está registrado en el sistema. Sincroniza con la API de TUS.",
        400,
      ),
    );
  }

  // 6. Buscar información del producto
  const productos = await ProductoCrocs.findByUpc(qrExistente.upc);
  if (productos.length === 0) {
    return next(
      new AppError(
        `No se encontró información del producto para UPC: ${qrExistente.upc}`,
        400,
      ),
    );
  }

  // 7. Verificar que el SKU del QR coincida con el SKU de la caja
  const skuCoincide = productos.some((p) => p.sku === caja.sku);
  if (!skuCoincide) {
    return next(
      new AppError(
        `El SKU del QR no coincide con el SKU de la caja. Esperado: ${caja.sku}, Encontrado: ${productos.map((p) => p.sku).join(", ")}`,
        400,
      ),
    );
  }

  // 8. Verificar que el QR no haya sido escaneado en esta u otra caja
  const queryQrDuplicado = `
    SELECT c.codigo_caja, c.id as caja_id
    FROM qr_codes_escaneados qr
    LEFT JOIN cajas_produccion c ON qr.caja_id = c.id
    WHERE qr.qr_code_normalizado = $1
  `;
  const resultDuplicado = await db.query(queryQrDuplicado, [qrNormalizado]);

  if (resultDuplicado.rows.length > 0) {
    const cajaAnterior = resultDuplicado.rows[0];
    return next(
      new AppError(
        `Este QR ya fue escaneado en la caja: ${cajaAnterior.codigo_caja}`,
        400,
      ),
    );
  }

  // 9. Registrar el QR escaneado
  const queryInsertQr = `
    INSERT INTO qr_codes_escaneados (
      qr_code,
      qr_code_normalizado,
      upc,
      sku,
      caja_id,
      tipo_escaneo,
      turno_id,
      escaneado_por
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  await db.query(queryInsertQr, [
    qrCode,
    qrNormalizado,
    qrExistente.upc,
    caja.sku,
    cajaId,
    "PRODUCCION",
    caja.turno_id,
    req.usuario.id,
  ]);

  // NOTA: El trigger 'trigger_actualizar_contador_qr_caja' incrementa automáticamente
  // el contador y completa la caja cuando se llega a cantidad_pares

  // 10. Verificar si la caja se completó
  const cajaActualizada = await Caja.findById(cajaId);
  let mensaje = `QR agregado exitosamente. ${cajaActualizada.cantidad_pares - cajaActualizada.cantidad_qr_escaneados} QRs faltantes.`;

  if (cajaActualizada.estado === "COMPLETADA") {
    mensaje =
      "¡Caja completada exitosamente! Todos los QRs han sido escaneados.";

    // Log de caja completada
    await registrarLog({
      usuarioId: req.usuario.id,
      accion: "COMPLETAR_CAJA",
      modulo: "Producción",
      tablaAfectada: "cajas_produccion",
      registroId: parseInt(cajaId),
      descripcion: `Caja completada: ${caja.codigo_caja}`,
      ipAddress: obtenerIP(req),
      userAgent: obtenerUserAgent(req),
    });
  }

  // 11. Obtener progreso actualizado
  const progreso = await Caja.getProgreso(cajaId);

  sendSuccess(res, 200, { caja: progreso }, mensaje);
});

// =============================================
// CONSULTAS
// =============================================

/**
 * Obtener información de una caja
 */
const getCaja = catchAsync(async (req, res, next) => {
  const { cajaId } = req.params;

  const caja = await Caja.findById(cajaId);
  if (!caja) {
    return next(new AppError("Caja no encontrada", 404));
  }

  const progreso = await Caja.getProgreso(cajaId);

  sendSuccess(res, 200, { caja: progreso });
});

/**
 * Listar cajas con filtros
 */
const getCajas = catchAsync(async (req, res, next) => {
  const {
    estado,
    sku,
    turnoId,
    fechaInicio,
    fechaFin,
    escaneadoPor,
    limit = 50,
    offset = 0,
  } = req.query;

  const filters = {
    estado,
    sku,
    turnoId: turnoId ? parseInt(turnoId) : undefined,
    fechaInicio,
    fechaFin,
    escaneadoPor: escaneadoPor ? parseInt(escaneadoPor) : undefined,
    limit: parseInt(limit),
    offset: parseInt(offset),
  };

  const [cajas, total] = await Promise.all([
    Caja.findAll(filters),
    Caja.count(filters),
  ]);

  sendSuccess(res, 200, {
    cajas,
    pagination: {
      total,
      limit: filters.limit,
      offset: filters.offset,
      pages: Math.ceil(total / filters.limit),
    },
  });
});

/**
 * Obtener cajas en proceso
 */
const getCajasEnProceso = catchAsync(async (req, res, next) => {
  const { turnoId, escaneadoPor, limit = 20 } = req.query;

  const filters = {
    turnoId: turnoId ? parseInt(turnoId) : undefined,
    escaneadoPor: escaneadoPor ? parseInt(escaneadoPor) : undefined,
    limit: parseInt(limit),
  };

  const cajas = await Caja.getCajasEnProceso(filters);

  sendSuccess(res, 200, { cajas, total: cajas.length });
});

/**
 * Obtener estadísticas de producción
 */
const getEstadisticas = catchAsync(async (req, res, next) => {
  const { fechaInicio, fechaFin } = req.query;

  if (!fechaInicio || !fechaFin) {
    return next(new AppError("Se requieren fechaInicio y fechaFin", 400));
  }

  const estadisticas = await Caja.getEstadisticas(fechaInicio, fechaFin);

  sendSuccess(res, 200, { estadisticas });
});

/**
 * Dashboard de producción
 */
const getDashboard = catchAsync(async (req, res, next) => {
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

  const [estadisticasHoy, cajasEnProceso] = await Promise.all([
    Caja.getEstadisticas(inicioHoy, finHoy),
    Caja.getCajasEnProceso({ limit: 10 }),
  ]);

  sendSuccess(res, 200, {
    hoy: estadisticasHoy,
    cajasEnProceso,
  });
});

module.exports = {
  // Escaneo
  escanearCaja,
  agregarQrACaja,
  // Consultas
  getCaja,
  getCajas,
  getCajasEnProceso,
  getEstadisticas,
  // Dashboard
  getDashboard,
};
