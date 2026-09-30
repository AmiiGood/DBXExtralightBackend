const db = require("../config/database");

class TipoDefecto {
  /**
   * Obtener todos los tipos de defectos
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT
        td.id,
        td.nombre,
        td.descripcion,
        td.activo,
        td.grupo_defecto_id,
        gd.nombre as grupo,
        td.creado_en,
        td.actualizado_en
      FROM tipos_defectos td
      LEFT JOIN grupos_defecto gd ON gd.id = td.grupo_defecto_id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND td.activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    // Filtrar por grupo de defecto (GENERAL / ENSAMBLE / DIGITAL_PRINTING)
    if (filters.grupo) {
      query += ` AND gd.nombre = $${paramCount}`;
      values.push(filters.grupo);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND td.nombre ILIKE $${paramCount}`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    query += " ORDER BY td.nombre ASC";

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Buscar tipo de defecto por ID
   */
  static async findById(id) {
    const query = `
      SELECT
        td.id,
        td.nombre,
        td.descripcion,
        td.activo,
        gd.nombre AS grupo
      FROM tipos_defectos td
      LEFT JOIN grupos_defecto gd ON gd.id = td.grupo_defecto_id
      WHERE td.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Buscar tipo de defecto por nombre
   */
  static async findByName(nombre, grupo) {
    const query = `
      SELECT
        td.id,
        td.nombre,
        td.descripcion,
        td.activo
      FROM tipos_defectos td
      JOIN grupos_defecto gd ON gd.id = td.grupo_defecto_id
      WHERE td.nombre = $1 AND gd.nombre = $2
    `;

    const result = await db.query(query, [nombre, grupo]);
    return result.rows[0];
  }

  /**
   * Crear un nuevo tipo de defecto
   */
  static async create(data) {
    const { nombre, descripcion, grupo } = data;

    const query = `
      INSERT INTO tipos_defectos (nombre, descripcion, grupo_defecto_id)
      VALUES ($1, $2, (SELECT id FROM grupos_defecto WHERE nombre = $3))
      RETURNING id, nombre, descripcion, activo, grupo_defecto_id, creado_en
    `;

    const result = await db.query(query, [nombre, descripcion || null, grupo]);
    return result.rows[0];
  }

  /**
   * Actualizar tipo de defecto
   */
  static async update(id, data) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (data.nombre !== undefined) {
      fields.push(`nombre = $${paramCount}`);
      values.push(data.nombre);
      paramCount++;
    }

    if (data.descripcion !== undefined) {
      fields.push(`descripcion = $${paramCount}`);
      values.push(data.descripcion);
      paramCount++;
    }

    if (data.grupo !== undefined) {
      fields.push(
        `grupo_defecto_id = (SELECT id FROM grupos_defecto WHERE nombre = $${paramCount})`,
      );
      values.push(data.grupo);
      paramCount++;
    }

    if (data.activo !== undefined) {
      fields.push(`activo = $${paramCount}`);
      values.push(data.activo);
      paramCount++;
    }

    if (fields.length === 0) {
      throw new Error("No hay campos para actualizar");
    }

    values.push(id);
    const query = `
      UPDATE tipos_defectos 
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, nombre, descripcion, activo
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }
}

module.exports = TipoDefecto;
