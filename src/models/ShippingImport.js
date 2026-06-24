const db = require("../config/database");

class ShippingImport {
  /**
   * Registrar una importación
   */
  static async create(data) {
    const {
      nombreArchivo,
      totalPos,
      posCreadas,
      totalCartones,
      cartonesCreados,
      errores,
      importadoPor,
    } = data;

    const query = `
      INSERT INTO shipping_imports (
        nombre_archivo,
        total_pos,
        pos_creadas,
        total_cartones,
        cartones_creados,
        errores,
        importado_por
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await db.query(query, [
      nombreArchivo,
      totalPos || 0,
      posCreadas || 0,
      totalCartones || 0,
      cartonesCreados || 0,
      errores ? JSON.stringify(errores) : null,
      importadoPor,
    ]);

    return result.rows[0];
  }

  /**
   * Obtener historial de importaciones
   */
  static async findAll(limit = 20) {
    const query = `
      SELECT 
        si.*,
        u.nombre_completo as importado_por_nombre,
        u.nombre_usuario as importado_por_usuario
      FROM shipping_imports si
      LEFT JOIN usuarios u ON si.importado_por = u.id
      ORDER BY si.creado_en DESC
      LIMIT $1
    `;

    const result = await db.query(query, [limit]);
    return result.rows;
  }

  /**
   * Obtener importación por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        si.*,
        u.nombre_completo as importado_por_nombre,
        u.nombre_usuario as importado_por_usuario
      FROM shipping_imports si
      LEFT JOIN usuarios u ON si.importado_por = u.id
      WHERE si.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener última importación exitosa
   */
  static async getUltimaImportacion() {
    const query = `
      SELECT *
      FROM shipping_imports
      WHERE (total_pos = pos_creadas) AND (total_cartones = cartones_creados)
      ORDER BY creado_en DESC
      LIMIT 1
    `;

    const result = await db.query(query);
    return result.rows[0];
  }

  /**
   * Obtener estadísticas de importaciones
   */
  static async getEstadisticas() {
    const query = `
      SELECT 
        COUNT(*) as total_importaciones,
        SUM(total_pos) as total_pos_importadas,
        SUM(total_cartones) as total_cartones_importados,
        MAX(creado_en) as ultima_importacion
      FROM shipping_imports
    `;

    const result = await db.query(query);
    return result.rows[0];
  }
}

module.exports = ShippingImport;
