const db = require("../config/database");

class Log {
  /**
   * Obtener todos los logs con filtros y paginación
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        ls.id,
        ls.usuario_id,
        u.nombre_usuario,
        u.nombre_completo as usuario_nombre,
        ls.accion,
        ls.modulo,
        ls.tabla_afectada,
        ls.registro_id,
        ls.descripcion,
        ls.ip_address,
        ls.user_agent,
        ls.datos_anteriores,
        ls.datos_nuevos,
        ls.creado_en
      FROM logs_sistema ls
      LEFT JOIN usuarios u ON ls.usuario_id = u.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    // Filtro por fecha inicio
    if (filters.fechaInicio) {
      query += ` AND ls.creado_en >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    // Filtro por fecha fin
    if (filters.fechaFin) {
      query += ` AND ls.creado_en <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    // Filtro por usuario
    if (filters.usuarioId) {
      query += ` AND ls.usuario_id = $${paramCount}`;
      values.push(filters.usuarioId);
      paramCount++;
    }

    // Filtro por acción
    if (filters.accion) {
      query += ` AND ls.accion = $${paramCount}`;
      values.push(filters.accion);
      paramCount++;
    }

    // Filtro por módulo
    if (filters.modulo) {
      query += ` AND ls.modulo ILIKE $${paramCount}`;
      values.push(`%${filters.modulo}%`);
      paramCount++;
    }

    // Filtro por tabla afectada
    if (filters.tablaAfectada) {
      query += ` AND ls.tabla_afectada = $${paramCount}`;
      values.push(filters.tablaAfectada);
      paramCount++;
    }

    // Búsqueda general en descripción
    if (filters.search) {
      query += ` AND (ls.descripcion ILIKE $${paramCount} OR u.nombre_usuario ILIKE $${paramCount} OR u.nombre_completo ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    // Ordenamiento
    const orderBy = filters.orderBy || "creado_en";
    const orderDir = filters.orderDir || "DESC";
    query += ` ORDER BY ls.${orderBy} ${orderDir}`;

    // Paginación
    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
      paramCount++;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Contar logs con filtros (para paginación)
   */
  static async count(filters = {}) {
    let query = `
      SELECT COUNT(*) as total
      FROM logs_sistema ls
      LEFT JOIN usuarios u ON ls.usuario_id = u.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.fechaInicio) {
      query += ` AND ls.creado_en >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    if (filters.fechaFin) {
      query += ` AND ls.creado_en <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    if (filters.usuarioId) {
      query += ` AND ls.usuario_id = $${paramCount}`;
      values.push(filters.usuarioId);
      paramCount++;
    }

    if (filters.accion) {
      query += ` AND ls.accion = $${paramCount}`;
      values.push(filters.accion);
      paramCount++;
    }

    if (filters.modulo) {
      query += ` AND ls.modulo ILIKE $${paramCount}`;
      values.push(`%${filters.modulo}%`);
      paramCount++;
    }

    if (filters.tablaAfectada) {
      query += ` AND ls.tabla_afectada = $${paramCount}`;
      values.push(filters.tablaAfectada);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (ls.descripcion ILIKE $${paramCount} OR u.nombre_usuario ILIKE $${paramCount} OR u.nombre_completo ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].total);
  }

  /**
   * Obtener log por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        ls.id,
        ls.usuario_id,
        u.nombre_usuario,
        u.nombre_completo as usuario_nombre,
        ls.accion,
        ls.modulo,
        ls.tabla_afectada,
        ls.registro_id,
        ls.descripcion,
        ls.ip_address,
        ls.user_agent,
        ls.datos_anteriores,
        ls.datos_nuevos,
        ls.creado_en
      FROM logs_sistema ls
      LEFT JOIN usuarios u ON ls.usuario_id = u.id
      WHERE ls.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener acciones únicas para filtros
   */
  static async getAcciones() {
    const query = `
      SELECT DISTINCT accion
      FROM logs_sistema
      WHERE accion IS NOT NULL
      ORDER BY accion ASC
    `;

    const result = await db.query(query);
    return result.rows.map((r) => r.accion);
  }

  /**
   * Obtener módulos únicos para filtros
   */
  static async getModulos() {
    const query = `
      SELECT DISTINCT modulo
      FROM logs_sistema
      WHERE modulo IS NOT NULL
      ORDER BY modulo ASC
    `;

    const result = await db.query(query);
    return result.rows.map((r) => r.modulo);
  }

  /**
   * Obtener tablas únicas para filtros
   */
  static async getTablas() {
    const query = `
      SELECT DISTINCT tabla_afectada
      FROM logs_sistema
      WHERE tabla_afectada IS NOT NULL
      ORDER BY tabla_afectada ASC
    `;

    const result = await db.query(query);
    return result.rows.map((r) => r.tabla_afectada);
  }

  /**
   * Obtener estadísticas de logs
   */
  static async getEstadisticas(fechaInicio, fechaFin) {
    const query = `
      SELECT 
        accion,
        COUNT(*) as total
      FROM logs_sistema
      WHERE creado_en >= $1 AND creado_en <= $2
      GROUP BY accion
      ORDER BY total DESC
    `;

    const result = await db.query(query, [fechaInicio, fechaFin]);
    return result.rows;
  }

  /**
   * Obtener actividad por usuario
   */
  static async getActividadPorUsuario(fechaInicio, fechaFin, limit = 10) {
    const query = `
      SELECT 
        u.id as usuario_id,
        u.nombre_usuario,
        u.nombre_completo,
        COUNT(*) as total_acciones
      FROM logs_sistema ls
      JOIN usuarios u ON ls.usuario_id = u.id
      WHERE ls.creado_en >= $1 AND ls.creado_en <= $2
      GROUP BY u.id, u.nombre_usuario, u.nombre_completo
      ORDER BY total_acciones DESC
      LIMIT $3
    `;

    const result = await db.query(query, [fechaInicio, fechaFin, limit]);
    return result.rows;
  }
}

module.exports = Log;
