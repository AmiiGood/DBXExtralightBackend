const db = require("../config/database");

class QrCargaExcel {
  /**
   * Registrar una carga de Excel
   */
  static async create(data) {
    const query = `
      INSERT INTO qr_cargas_excel (nombre_archivo, total_registros, registros_nuevos, registros_actualizados, registros_error, cargado_por)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await db.query(query, [
      data.nombreArchivo,
      data.totalRegistros || 0,
      data.registrosNuevos || 0,
      data.registrosActualizados || 0,
      data.registrosError || 0,
      data.cargadoPor,
    ]);

    return result.rows[0];
  }

  /**
   * Obtener historial de cargas
   */
  static async findAll(limit = 20) {
    const query = `
      SELECT 
        qce.*,
        u.nombre_completo as cargado_por_nombre
      FROM qr_cargas_excel qce
      LEFT JOIN usuarios u ON qce.cargado_por = u.id
      ORDER BY qce.creado_en DESC
      LIMIT $1
    `;
    const result = await db.query(query, [limit]);
    return result.rows;
  }
}

module.exports = QrCargaExcel;
