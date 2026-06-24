const db = require("../config/database");

/**
 * Registra una acción en la tabla de logs del sistema
 * @param {Object} logData - Datos del log
 * @param {Number} logData.usuarioId - ID del usuario que realiza la acción
 * @param {String} logData.accion - Tipo de acción (INSERT, UPDATE, DELETE, LOGIN, etc.)
 * @param {String} logData.modulo - Módulo afectado
 * @param {String} logData.tablaAfectada - Tabla afectada (opcional)
 * @param {Number} logData.registroId - ID del registro afectado (opcional)
 * @param {String} logData.descripcion - Descripción de la acción
 * @param {String} logData.ipAddress - Dirección IP del usuario (opcional)
 * @param {String} logData.userAgent - User agent del navegador (opcional)
 * @param {Object} logData.datosAnteriores - Datos anteriores (opcional)
 * @param {Object} logData.datosNuevos - Datos nuevos (opcional)
 */
const registrarLog = async (logData) => {
  try {
    const query = `
      INSERT INTO logs_sistema (
        usuario_id,
        accion,
        modulo,
        tabla_afectada,
        registro_id,
        descripcion,
        ip_address,
        user_agent,
        datos_anteriores,
        datos_nuevos
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `;

    const values = [
      logData.usuarioId,
      logData.accion,
      logData.modulo,
      logData.tablaAfectada || null,
      logData.registroId || null,
      logData.descripcion,
      logData.ipAddress || null,
      logData.userAgent || null,
      logData.datosAnteriores ? JSON.stringify(logData.datosAnteriores) : null,
      logData.datosNuevos ? JSON.stringify(logData.datosNuevos) : null,
    ];

    const result = await db.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error("Error al registrar log:", error);
    // No lanzamos el error para no interrumpir el flujo principal
  }
};

/**
 * Extrae la IP del request
 */
const obtenerIP = (req) => {
  return (
    req.ip || req.connection.remoteAddress || req.headers["x-forwarded-for"]
  );
};

/**
 * Extrae el User Agent del request
 */
const obtenerUserAgent = (req) => {
  return req.headers["user-agent"] || "Unknown";
};

module.exports = {
  registrarLog,
  obtenerIP,
  obtenerUserAgent,
};
