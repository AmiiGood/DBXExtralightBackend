const db = require("../config/database");

class Caja {
  /**
   * Crear una nueva caja (al escanear el código de caja)
   */
  static async create(data) {
    const {
      codigoCaja,
      sku,
      cantidadPares,
      consecutivo,
      codigoCompleto,
      turnoId,
      escaneadoPor,
    } = data;

    const query = `
      INSERT INTO cajas_produccion (
        codigo_caja,
        sku,
        cantidad_pares,
        consecutivo,
        codigo_completo,
        turno_id,
        escaneado_por,
        estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_PROCESO')
      RETURNING *
    `;

    const result = await db.query(query, [
      codigoCaja,
      sku,
      cantidadPares,
      consecutivo,
      codigoCompleto,
      turnoId || null,
      escaneadoPor,
    ]);

    return result.rows[0];
  }

  /**
   * Buscar caja por código de caja
   */
  static async findByCodigoCaja(codigoCaja) {
    const query = `
      SELECT 
        c.*,
        t.nombre as turno_nombre,
        u_esc.nombre_completo as escaneado_por_nombre,
        u_comp.nombre_completo as completado_por_nombre
      FROM cajas_produccion c
      LEFT JOIN turnos t ON c.turno_id = t.id
      LEFT JOIN usuarios u_esc ON c.escaneado_por = u_esc.id
      LEFT JOIN usuarios u_comp ON c.completado_por = u_comp.id
      WHERE c.codigo_caja = $1
    `;

    const result = await db.query(query, [codigoCaja]);
    return result.rows[0];
  }

  /**
   * Buscar caja por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        c.*,
        t.nombre as turno_nombre,
        u_esc.nombre_completo as escaneado_por_nombre,
        u_comp.nombre_completo as completado_por_nombre
      FROM cajas_produccion c
      LEFT JOIN turnos t ON c.turno_id = t.id
      LEFT JOIN usuarios u_esc ON c.escaneado_por = u_esc.id
      LEFT JOIN usuarios u_comp ON c.completado_por = u_comp.id
      WHERE c.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener todas las cajas con filtros
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        c.*,
        t.nombre as turno_nombre,
        u_esc.nombre_completo as escaneado_por_nombre
      FROM cajas_produccion c
      LEFT JOIN turnos t ON c.turno_id = t.id
      LEFT JOIN usuarios u_esc ON c.escaneado_por = u_esc.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.estado) {
      query += ` AND c.estado = $${paramCount}`;
      values.push(filters.estado);
      paramCount++;
    }

    if (filters.sku) {
      query += ` AND c.sku = $${paramCount}`;
      values.push(filters.sku);
      paramCount++;
    }

    if (filters.turnoId) {
      query += ` AND c.turno_id = $${paramCount}`;
      values.push(filters.turnoId);
      paramCount++;
    }

    if (filters.fechaInicio) {
      query += ` AND c.fecha_escaneado >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    if (filters.fechaFin) {
      query += ` AND c.fecha_escaneado <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    if (filters.escaneadoPor) {
      query += ` AND c.escaneado_por = $${paramCount}`;
      values.push(filters.escaneadoPor);
      paramCount++;
    }

    query += ` ORDER BY c.fecha_escaneado DESC`;

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset !== undefined) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
      paramCount++;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Contar cajas con filtros
   */
  static async count(filters = {}) {
    let query = `SELECT COUNT(*) as total FROM cajas_produccion WHERE 1=1`;

    const values = [];
    let paramCount = 1;

    if (filters.estado) {
      query += ` AND estado = $${paramCount}`;
      values.push(filters.estado);
      paramCount++;
    }

    if (filters.sku) {
      query += ` AND sku = $${paramCount}`;
      values.push(filters.sku);
      paramCount++;
    }

    if (filters.turnoId) {
      query += ` AND turno_id = $${paramCount}`;
      values.push(filters.turnoId);
      paramCount++;
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].total);
  }

  /**
   * Incrementar el contador de QRs escaneados
   */
  static async incrementarQrEscaneados(cajaId) {
    const query = `
      UPDATE cajas_produccion
      SET cantidad_qr_escaneados = cantidad_qr_escaneados + 1,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;

    const result = await db.query(query, [cajaId]);
    return result.rows[0];
  }

  /**
   * Marcar caja como completada
   */
  static async completarCaja(cajaId, completadoPor) {
    const query = `
      UPDATE cajas_produccion
      SET estado = 'COMPLETADA',
          fecha_completado = CURRENT_TIMESTAMP,
          completado_por = $1,
          actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(query, [completadoPor, cajaId]);
    return result.rows[0];
  }

  /**
   * Verificar si una caja está completa (todos los QRs escaneados)
   */
  static async estaCompleta(cajaId) {
    const query = `
      SELECT cantidad_pares, cantidad_qr_escaneados
      FROM cajas_produccion
      WHERE id = $1
    `;

    const result = await db.query(query, [cajaId]);
    if (result.rows.length === 0) return false;

    const caja = result.rows[0];
    return caja.cantidad_qr_escaneados >= caja.cantidad_pares;
  }

  /**
   * Obtener información de progreso de una caja
   */
  static async getProgreso(cajaId) {
    const query = `
      SELECT 
        id,
        codigo_caja,
        sku,
        cantidad_pares,
        cantidad_qr_escaneados,
        estado,
        (cantidad_pares - cantidad_qr_escaneados) as faltantes,
        ROUND((cantidad_qr_escaneados::DECIMAL / cantidad_pares * 100), 2) as porcentaje_completado
      FROM cajas_produccion
      WHERE id = $1
    `;

    const result = await db.query(query, [cajaId]);
    return result.rows[0];
  }

  /**
   * Obtener cajas en proceso (no completadas)
   */
  static async getCajasEnProceso(filters = {}) {
    let query = `
      SELECT 
        c.*,
        t.nombre as turno_nombre,
        u.nombre_completo as escaneado_por_nombre,
        (c.cantidad_pares - c.cantidad_qr_escaneados) as faltantes
      FROM cajas_produccion c
      LEFT JOIN turnos t ON c.turno_id = t.id
      LEFT JOIN usuarios u ON c.escaneado_por = u.id
      WHERE c.estado = 'EN_PROCESO'
    `;

    const values = [];
    let paramCount = 1;

    if (filters.turnoId) {
      query += ` AND c.turno_id = $${paramCount}`;
      values.push(filters.turnoId);
      paramCount++;
    }

    if (filters.escaneadoPor) {
      query += ` AND c.escaneado_por = $${paramCount}`;
      values.push(filters.escaneadoPor);
      paramCount++;
    }

    query += ` ORDER BY c.fecha_escaneado DESC`;

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Obtener estadísticas de producción
   */
  static async getEstadisticas(fechaInicio, fechaFin) {
    const query = `
      SELECT 
        COUNT(*) as total_cajas,
        COUNT(*) FILTER (WHERE estado = 'COMPLETADA') as cajas_completadas,
        COUNT(*) FILTER (WHERE estado = 'EN_PROCESO') as cajas_en_proceso,
        SUM(cantidad_pares) as total_pares_esperados,
        SUM(cantidad_qr_escaneados) as total_qr_escaneados,
        COUNT(DISTINCT sku) as skus_diferentes
      FROM cajas_produccion
      WHERE fecha_escaneado >= $1 AND fecha_escaneado <= $2
    `;

    const result = await db.query(query, [fechaInicio, fechaFin]);
    return result.rows[0];
  }
}

module.exports = Caja;
