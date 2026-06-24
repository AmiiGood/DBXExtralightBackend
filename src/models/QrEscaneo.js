const db = require("../config/database");

class QrEscaneo {
  /**
   * Registrar un nuevo escaneo
   */
  static async create(data) {
    const {
      qrRaw,
      qrNormalizado,
      upcEncontrado,
      productoEncontrado,
      resultado,
      escaneadoPor,
      turnoId,
    } = data;

    const query = `
      INSERT INTO qr_escaneos (qr_raw, qr_normalizado, upc_encontrado, producto_encontrado, resultado, escaneado_por, turno_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, uuid, qr_raw, qr_normalizado, upc_encontrado, producto_encontrado, resultado, creado_en
    `;

    const result = await db.query(query, [
      qrRaw,
      qrNormalizado || null,
      upcEncontrado || null,
      productoEncontrado || false,
      resultado ? JSON.stringify(resultado) : null,
      escaneadoPor,
      turnoId || null,
    ]);

    return result.rows[0];
  }

  /**
   * Obtener escaneos con filtros y paginación
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        qe.id, qe.uuid, qe.qr_raw, qe.qr_normalizado,
        qe.upc_encontrado, qe.producto_encontrado,
        qe.resultado, qe.creado_en,
        u.nombre_completo as escaneado_por_nombre,
        u.nombre_usuario as escaneado_por_usuario,
        t.nombre as turno_nombre
      FROM qr_escaneos qe
      LEFT JOIN usuarios u ON qe.escaneado_por = u.id
      LEFT JOIN turnos t ON qe.turno_id = t.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.fechaInicio) {
      query += ` AND qe.creado_en >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    if (filters.fechaFin) {
      query += ` AND qe.creado_en <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    if (filters.escaneadoPor) {
      query += ` AND qe.escaneado_por = $${paramCount}`;
      values.push(filters.escaneadoPor);
      paramCount++;
    }

    if (filters.productoEncontrado !== undefined) {
      query += ` AND qe.producto_encontrado = $${paramCount}`;
      values.push(filters.productoEncontrado);
      paramCount++;
    }

    if (filters.upc) {
      query += ` AND qe.upc_encontrado = $${paramCount}`;
      values.push(filters.upc);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (qe.qr_raw ILIKE $${paramCount} OR qe.qr_normalizado ILIKE $${paramCount} OR qe.upc_encontrado ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    query += ` ORDER BY qe.creado_en DESC`;

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
   * Contar escaneos con filtros
   */
  static async count(filters = {}) {
    let query = `SELECT COUNT(*) as total FROM qr_escaneos qe WHERE 1=1`;

    const values = [];
    let paramCount = 1;

    if (filters.fechaInicio) {
      query += ` AND qe.creado_en >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    if (filters.fechaFin) {
      query += ` AND qe.creado_en <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    if (filters.escaneadoPor) {
      query += ` AND qe.escaneado_por = $${paramCount}`;
      values.push(filters.escaneadoPor);
      paramCount++;
    }

    if (filters.productoEncontrado !== undefined) {
      query += ` AND qe.producto_encontrado = $${paramCount}`;
      values.push(filters.productoEncontrado);
      paramCount++;
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].total);
  }

  /**
   * Obtener estadísticas de escaneos
   */
  static async getEstadisticas(fechaInicio, fechaFin) {
    const query = `
      SELECT 
        COUNT(*) as total_escaneos,
        COUNT(CASE WHEN producto_encontrado = true THEN 1 END) as encontrados,
        COUNT(CASE WHEN producto_encontrado = false THEN 1 END) as no_encontrados,
        COUNT(DISTINCT upc_encontrado) as upcs_unicos,
        COUNT(DISTINCT escaneado_por) as usuarios_activos
      FROM qr_escaneos
      WHERE creado_en >= $1 AND creado_en <= $2
    `;

    const result = await db.query(query, [fechaInicio, fechaFin]);
    return result.rows[0];
  }

  /**
   * Obtener escaneos agrupados por UPC
   */
  static async getResumenPorUpc(fechaInicio, fechaFin, limit = 20) {
    const query = `
      SELECT 
        qe.upc_encontrado as upc,
        pc.style_name,
        pc.color,
        COUNT(*) as total_escaneos,
        COUNT(CASE WHEN qe.producto_encontrado = true THEN 1 END) as validados
      FROM qr_escaneos qe
      LEFT JOIN productos_crocs pc ON qe.upc_encontrado = pc.upc
      WHERE qe.creado_en >= $1 AND qe.creado_en <= $2 AND qe.upc_encontrado IS NOT NULL
      GROUP BY qe.upc_encontrado, pc.style_name, pc.color
      ORDER BY total_escaneos DESC
      LIMIT $3
    `;

    const result = await db.query(query, [fechaInicio, fechaFin, limit]);
    return result.rows;
  }
}

module.exports = QrEscaneo;
