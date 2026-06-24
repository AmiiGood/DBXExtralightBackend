const db = require("../config/database");

class RolModulo {
  /**
   * Obtener todos los permisos de un rol
   */
  static async findByRolId(rolId) {
    const query = `
      SELECT 
        rm.id,
        rm.rol_id,
        rm.modulo_id,
        m.nombre as modulo_nombre,
        m.descripcion as modulo_descripcion,
        m.ruta,
        m.icono,
        m.orden,
        rm.puede_leer,
        rm.puede_crear,
        rm.puede_editar,
        rm.puede_eliminar
      FROM roles_modulos rm
      JOIN modulos m ON rm.modulo_id = m.id
      WHERE rm.rol_id = $1 AND m.activo = true
      ORDER BY m.orden ASC
    `;

    const result = await db.query(query, [rolId]);
    return result.rows;
  }

  /**
   * Obtener todos los módulos con los permisos de un rol específico
   * (incluye módulos sin permisos asignados)
   */
  static async findAllModulosWithPermisos(rolId) {
    const query = `
      SELECT 
        m.id as modulo_id,
        m.nombre as modulo_nombre,
        m.descripcion as modulo_descripcion,
        m.ruta,
        m.icono,
        m.orden,
        COALESCE(rm.puede_leer, false) as puede_leer,
        COALESCE(rm.puede_crear, false) as puede_crear,
        COALESCE(rm.puede_editar, false) as puede_editar,
        COALESCE(rm.puede_eliminar, false) as puede_eliminar,
        rm.id as permiso_id
      FROM modulos m
      LEFT JOIN roles_modulos rm ON m.id = rm.modulo_id AND rm.rol_id = $1
      WHERE m.activo = true
      ORDER BY m.orden ASC
    `;

    const result = await db.query(query, [rolId]);
    return result.rows;
  }

  /**
   * Obtener módulos accesibles para un usuario (para el sidebar)
   */
  static async getModulosAccesibles(rolId, esAdmin) {
    // Si es admin, devuelve todos los módulos activos
    if (esAdmin) {
      const query = `
        SELECT 
          id,
          nombre,
          descripcion,
          ruta,
          icono,
          orden
        FROM modulos
        WHERE activo = true
        ORDER BY orden ASC
      `;
      const result = await db.query(query);
      return result.rows;
    }

    // Si no es admin, devuelve solo los módulos con puede_leer = true
    const query = `
      SELECT 
        m.id,
        m.nombre,
        m.descripcion,
        m.ruta,
        m.icono,
        m.orden
      FROM modulos m
      JOIN roles_modulos rm ON m.id = rm.modulo_id
      WHERE rm.rol_id = $1 
        AND rm.puede_leer = true 
        AND m.activo = true
      ORDER BY m.orden ASC
    `;

    const result = await db.query(query, [rolId]);
    return result.rows;
  }

  /**
   * Verificar si un rol tiene un permiso específico en un módulo
   */
  static async verificarPermiso(rolId, moduloRuta, tipoPermiso = "puede_leer") {
    const permisosValidos = [
      "puede_leer",
      "puede_crear",
      "puede_editar",
      "puede_eliminar",
    ];

    if (!permisosValidos.includes(tipoPermiso)) {
      throw new Error(`Tipo de permiso inválido: ${tipoPermiso}`);
    }

    const query = `
      SELECT rm.${tipoPermiso} as tiene_permiso
      FROM roles_modulos rm
      JOIN modulos m ON rm.modulo_id = m.id
      WHERE rm.rol_id = $1 AND m.ruta = $2 AND m.activo = true
    `;

    const result = await db.query(query, [rolId, moduloRuta]);

    if (result.rows.length === 0) {
      return false;
    }

    return result.rows[0].tiene_permiso;
  }

  /**
   * Actualizar permisos de un rol para un módulo específico
   */
  static async upsertPermiso(rolId, moduloId, permisos) {
    const { puedeLeer, puedeCrear, puedeEditar, puedeEliminar } = permisos;

    // Si todos los permisos son false, eliminar el registro
    if (!puedeLeer && !puedeCrear && !puedeEditar && !puedeEliminar) {
      const deleteQuery = `
        DELETE FROM roles_modulos 
        WHERE rol_id = $1 AND modulo_id = $2
        RETURNING id
      `;
      const result = await db.query(deleteQuery, [rolId, moduloId]);
      return { deleted: result.rowCount > 0 };
    }

    // Upsert: insertar o actualizar
    const query = `
      INSERT INTO roles_modulos (rol_id, modulo_id, puede_leer, puede_crear, puede_editar, puede_eliminar)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (rol_id, modulo_id) 
      DO UPDATE SET 
        puede_leer = EXCLUDED.puede_leer,
        puede_crear = EXCLUDED.puede_crear,
        puede_editar = EXCLUDED.puede_editar,
        puede_eliminar = EXCLUDED.puede_eliminar
      RETURNING id, rol_id, modulo_id, puede_leer, puede_crear, puede_editar, puede_eliminar
    `;

    const result = await db.query(query, [
      rolId,
      moduloId,
      puedeLeer || false,
      puedeCrear || false,
      puedeEditar || false,
      puedeEliminar || false,
    ]);

    return result.rows[0];
  }

  /**
   * Actualizar todos los permisos de un rol de una vez
   */
  static async actualizarPermisosRol(rolId, permisos) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM roles_modulos WHERE rol_id = $1", [
        rolId,
      ]);

      for (const permiso of permisos) {
        const { moduloId, puedeLeer, puedeCrear, puedeEditar, puedeEliminar } =
          permiso;

        if (puedeLeer || puedeCrear || puedeEditar || puedeEliminar) {
          await client.query(
            `INSERT INTO roles_modulos 
           (rol_id, modulo_id, puede_leer, puede_crear, puede_editar, puede_eliminar)
           VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              rolId,
              moduloId,
              puedeLeer ?? false,
              puedeCrear ?? false,
              puedeEditar ?? false,
              puedeEliminar ?? false,
            ],
          );
        }
      }

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Copiar permisos de un rol a otro
   */
  static async copiarPermisos(rolOrigenId, rolDestinoId) {
    const client = await db.pool.connect();

    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM roles_modulos WHERE rol_id = $1", [
        rolDestinoId,
      ]);

      await client.query(
        `INSERT INTO roles_modulos 
       (rol_id, modulo_id, puede_leer, puede_crear, puede_editar, puede_eliminar)
       SELECT $1, modulo_id, puede_leer, puede_crear, puede_editar, puede_eliminar
       FROM roles_modulos
       WHERE rol_id = $2`,
        [rolDestinoId, rolOrigenId],
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = RolModulo;
