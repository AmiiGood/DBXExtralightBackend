const db = require("../config/database");

class TipoDefecto {
  /**
   * Obtener todos los tipos de defectos
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
      FROM tipos_defectos
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND nombre ILIKE $${paramCount}`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    query += " ORDER BY nombre ASC";

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Buscar tipo de defecto por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        activo
      FROM tipos_defectos
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Buscar tipo de defecto por nombre
   */
  static async findByName(nombre) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        activo
      FROM tipos_defectos
      WHERE nombre = $1
    `;

    const result = await db.query(query, [nombre]);
    return result.rows[0];
  }

  /**
   * Crear un nuevo tipo de defecto
   */
  static async create(data) {
    const { nombre, descripcion } = data;

    const query = `
      INSERT INTO tipos_defectos (nombre, descripcion)
      VALUES ($1, $2)
      RETURNING id, nombre, descripcion, activo, creado_en
    `;

    const result = await db.query(query, [nombre, descripcion || null]);
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
