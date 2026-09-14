const db = require("../config/database");

class UnidadNegocio {
  /**
   * Obtener todas las unidades de negocio
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT id, nombre, activo, creado_en
      FROM unidades_negocio
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    query += " ORDER BY nombre ASC";

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Buscar unidad de negocio por ID
   */
  static async findById(id) {
    const query = `
      SELECT id, nombre, activo
      FROM unidades_negocio
      WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = UnidadNegocio;
