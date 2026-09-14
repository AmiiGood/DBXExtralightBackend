const db = require("../config/database");

class Modelo {
  /**
   * Obtener modelos, filtrando por unidad de negocio y/o búsqueda por nombre.
   * La búsqueda es case-insensitive por prefijo (autocompletar).
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT m.id, m.unidad_negocio_id, m.nombre, m.activo,
             un.nombre as unidad_negocio
      FROM modelos m
      JOIN unidades_negocio un ON un.id = m.unidad_negocio_id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.unidadNegocioId) {
      query += ` AND m.unidad_negocio_id = $${paramCount}`;
      values.push(filters.unidadNegocioId);
      paramCount++;
    }

    if (filters.activo !== undefined) {
      query += ` AND m.activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND m.nombre ILIKE $${paramCount}`;
      values.push(`${filters.search}%`);
      paramCount++;
    }

    query += " ORDER BY m.nombre ASC";

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Buscar modelo por ID
   */
  static async findById(id) {
    const query = `
      SELECT id, unidad_negocio_id, nombre, activo
      FROM modelos
      WHERE id = $1
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = Modelo;
