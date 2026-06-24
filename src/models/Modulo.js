const db = require("../config/database");

class Modulo {
  /**
   * Obtener todos los módulos
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        id,
        nombre,
        descripcion,
        ruta,
        icono,
        orden,
        activo,
        creado_en
      FROM modulos
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    query += ` ORDER BY orden ASC`;

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Obtener módulo por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        ruta,
        icono,
        orden,
        activo,
        creado_en
      FROM modulos
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener módulo por ruta
   */
  static async findByRuta(ruta) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        ruta,
        icono,
        orden,
        activo,
        creado_en
      FROM modulos
      WHERE ruta = $1
    `;

    const result = await db.query(query, [ruta]);
    return result.rows[0];
  }

  /**
   * Crear módulo
   */
  static async create(data) {
    const { nombre, descripcion, ruta, icono, orden } = data;

    const query = `
      INSERT INTO modulos (nombre, descripcion, ruta, icono, orden)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, nombre, descripcion, ruta, icono, orden, activo, creado_en
    `;

    const result = await db.query(query, [
      nombre,
      descripcion || null,
      ruta || null,
      icono || null,
      orden || 0,
    ]);

    return result.rows[0];
  }

  /**
   * Actualizar módulo
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
    if (data.ruta !== undefined) {
      fields.push(`ruta = $${paramCount}`);
      values.push(data.ruta);
      paramCount++;
    }
    if (data.icono !== undefined) {
      fields.push(`icono = $${paramCount}`);
      values.push(data.icono);
      paramCount++;
    }
    if (data.orden !== undefined) {
      fields.push(`orden = $${paramCount}`);
      values.push(data.orden);
      paramCount++;
    }
    if (data.activo !== undefined) {
      fields.push(`activo = $${paramCount}`);
      values.push(data.activo);
      paramCount++;
    }

    if (fields.length === 0) {
      return null;
    }

    values.push(id);
    const query = `
      UPDATE modulos SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, nombre, descripcion, ruta, icono, orden, activo, creado_en
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }
}

module.exports = Modulo;
