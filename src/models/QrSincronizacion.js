const db = require("../config/database");

class QrSincronizacion {
  /**
   * Registrar una sincronización
   */
  static async create(data) {
    const query = `
      INSERT INTO qr_sincronizaciones (fecha_consulta, last_get_time, total_registros, nuevos_registros, estado, error_mensaje, ejecutado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await db.query(query, [
      data.fechaConsulta || new Date(),
      data.lastGetTime,
      data.totalRegistros || 0,
      data.nuevosRegistros || 0,
      data.estado || "success",
      data.errorMensaje || null,
      data.ejecutadoPor || null,
    ]);

    return result.rows[0];
  }

  /**
   * Obtener la última sincronización exitosa
   */
  static async getUltimaSincronizacion() {
    const query = `
      SELECT * FROM qr_sincronizaciones
      WHERE estado = 'success'
      ORDER BY creado_en DESC
      LIMIT 1
    `;
    const result = await db.query(query);
    return result.rows[0];
  }

  /**
   * Obtener historial de sincronizaciones
   */
  static async findAll(limit = 20) {
    const query = `
      SELECT 
        qs.*,
        u.nombre_completo as ejecutado_por_nombre
      FROM qr_sincronizaciones qs
      LEFT JOIN usuarios u ON qs.ejecutado_por = u.id
      ORDER BY qs.creado_en DESC
      LIMIT $1
    `;
    const result = await db.query(query, [limit]);
    return result.rows;
  }
}

module.exports = QrSincronizacion;
