const db = require("../config/database");
const bcrypt = require("bcryptjs");

class Usuario {
  /**
   * Buscar usuario por nombre de usuario
   */
  static async findByUsername(nombreUsuario) {
    const query = `
      SELECT 
        u.id, 
        u.uuid,
        u.nombre_usuario, 
        u.email, 
        u.password_hash,
        u.nombre_completo,
        u.activo,
        u.ultimo_acceso,
        r.id as rol_id,
        r.nombre as rol_nombre,
        r.es_admin,
        a.id as area_id,
        a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.nombre_usuario = $1
    `;

    const result = await db.query(query, [nombreUsuario]);
    return result.rows[0];
  }

  /**
   * Buscar usuario por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        u.id, 
        u.uuid,
        u.nombre_usuario, 
        u.email, 
        u.nombre_completo,
        u.password_hash,
        u.activo,
        u.ultimo_acceso,
        u.creado_en,
        r.id as rol_id,
        r.nombre as rol_nombre,
        r.es_admin,
        a.id as area_id,
        a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Buscar usuario por email
   */
  static async findByEmail(email) {
    const query = `
      SELECT 
        u.id, 
        u.uuid,
        u.nombre_usuario, 
        u.email, 
        u.password_hash,
        u.nombre_completo,
        u.activo,
        r.id as rol_id,
        r.nombre as rol_nombre,
        r.es_admin,
        a.id as area_id,
        a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.email = $1
    `;

    const result = await db.query(query, [email]);
    return result.rows[0];
  }

  /**
   * Obtener todos los usuarios
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        u.id, 
        u.uuid,
        u.nombre_usuario, 
        u.email, 
        u.nombre_completo,
        u.activo,
        u.ultimo_acceso,
        u.creado_en,
        r.id as rol_id,
        r.nombre as rol_nombre,
        r.es_admin,
        a.id as area_id,
        a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND u.activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    if (filters.rolId) {
      query += ` AND u.rol_id = $${paramCount}`;
      values.push(filters.rolId);
      paramCount++;
    }

    if (filters.areaId) {
      query += ` AND u.area_id = $${paramCount}`;
      values.push(filters.areaId);
      paramCount++;
    }

    query += " ORDER BY u.nombre_completo ASC";

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Crear un nuevo usuario
   */
  static async create(userData) {
    const {
      nombreUsuario,
      email,
      password,
      nombreCompleto,
      rolId,
      areaId,
      creadoPor,
    } = userData;

    // Hash de la contraseña
    const passwordHash = await bcrypt.hash(password, 12);

    const query = `
      INSERT INTO usuarios (
        nombre_usuario,
        email,
        password_hash,
        nombre_completo,
        rol_id,
        area_id,
        creado_por
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, uuid, nombre_usuario, email, nombre_completo, activo, creado_en
    `;

    const values = [
      nombreUsuario,
      email,
      passwordHash,
      nombreCompleto,
      rolId,
      areaId,
      creadoPor,
    ];
    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Actualizar un usuario
   */
  static async update(id, userData) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (userData.nombreUsuario !== undefined) {
      fields.push(`nombre_usuario = $${paramCount}`);
      values.push(userData.nombreUsuario);
      paramCount++;
    }

    if (userData.email !== undefined) {
      fields.push(`email = $${paramCount}`);
      values.push(userData.email);
      paramCount++;
    }

    if (userData.nombreCompleto !== undefined) {
      fields.push(`nombre_completo = $${paramCount}`);
      values.push(userData.nombreCompleto);
      paramCount++;
    }

    if (userData.rolId !== undefined) {
      fields.push(`rol_id = $${paramCount}`);
      values.push(userData.rolId);
      paramCount++;
    }

    if (userData.areaId !== undefined) {
      fields.push(`area_id = $${paramCount}`);
      values.push(userData.areaId);
      paramCount++;
    }

    if (userData.activo !== undefined) {
      fields.push(`activo = $${paramCount}`);
      values.push(userData.activo);
      paramCount++;
    }

    if (userData.password !== undefined) {
      const passwordHash = await bcrypt.hash(userData.password, 12);
      fields.push(`password_hash = $${paramCount}`);
      values.push(passwordHash);
      paramCount++;
    }

    if (fields.length === 0) {
      throw new Error("No hay campos para actualizar");
    }

    values.push(id);
    const query = `
      UPDATE usuarios 
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING id, uuid, nombre_usuario, email, nombre_completo, activo
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Actualizar último acceso del usuario
   */
  static async updateLastAccess(id) {
    const query = `
      UPDATE usuarios 
      SET ultimo_acceso = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING ultimo_acceso
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Eliminar usuario (soft delete)
   */
  static async softDelete(id) {
    const query = `
      UPDATE usuarios 
      SET activo = false
      WHERE id = $1
      RETURNING id, nombre_usuario
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Comparar contraseña
   */
  static async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}

module.exports = Usuario;
