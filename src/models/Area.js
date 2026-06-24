const db = require("../config/database");

class Area {
  /**
   * Obtener todas las áreas
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        id,
        nombre,
        descripcion,
        activo,
        creado_en,
        actualizado_en
      FROM areas
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
   * Buscar área por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        activo,
        creado_en,
        actualizado_en
      FROM areas
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Buscar área por nombre
   */
  static async findByName(nombre) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        activo
      FROM areas
      WHERE nombre = $1
    `;

    const result = await db.query(query, [nombre]);
    return result.rows[0];
  }
}

module.exports = Area;
