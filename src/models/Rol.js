const db = require("../config/database");

class Rol {
  /**
   * Obtener todos los roles
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        id,
        nombre,
        descripcion,
        es_admin,
        activo,
        creado_en,
        actualizado_en
      FROM roles
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
   * Buscar rol por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        es_admin,
        activo,
        creado_en,
        actualizado_en
      FROM roles
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Buscar rol por nombre
   */
  static async findByName(nombre) {
    const query = `
      SELECT 
        id,
        nombre,
        descripcion,
        es_admin,
        activo
      FROM roles
      WHERE nombre = $1
    `;

    const result = await db.query(query, [nombre]);
    return result.rows[0];
  }

  /**
   * Obtener permisos de un rol sobre módulos
   */
  static async getPermissions(rolId) {
    const query = `
      SELECT 
        m.id as modulo_id,
        m.nombre as modulo_nombre,
        m.descripcion as modulo_descripcion,
        rm.puede_leer,
        rm.puede_crear,
        rm.puede_editar,
        rm.puede_eliminar
      FROM roles_modulos rm
      JOIN modulos m ON rm.modulo_id = m.id
      WHERE rm.rol_id = $1
      ORDER BY m.orden, m.nombre
    `;

    const result = await db.query(query, [rolId]);
    return result.rows;
  }
}

module.exports = Rol;
