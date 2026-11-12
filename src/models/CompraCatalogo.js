const db = require("../config/database");
const { AppError } = require("../utils/errorHandler");

/**
 * Catálogos de los formatos de compra: tipos (los pone Compras), cuentas
 * contables (las pone Finanzas) y áreas solicitantes.
 *
 * Áreas: las ligadas a un tema del osTicket de Compras se configuran en
 * Aprobadores y aquí solo se listan. Las que no tienen tema (compran sin
 * ticket, migración 10) se agregan, renombran y desactivan aquí.
 *
 * Ver migrations/2026-11-11_compras_solicitudes_09_catalogos.sql. Los formatos
 * guardan el texto (nombre del tipo, número de cuenta), así que renombrar un
 * tipo también corrige los formatos que lo usan. Nada se borra: se desactiva.
 */

const limpio = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
/** "6202-000014" o "6202 000014" → "6202000014" */
const soloDigitos = (v) => String(v ?? "").replace(/\D/g, "");

class CompraCatalogo {
  static soloDigitos = soloDigitos;

  static async listar() {
    const [tipos, cuentas, areas] = await Promise.all([
      db.query("SELECT id, nombre, activo FROM compras_tipos ORDER BY lower(nombre)"),
      db.query("SELECT codigo, nombre, activo FROM compras_cuentas ORDER BY codigo"),
      db.query(
        `SELECT id, nombre, activo, osticket_topic_id IS NOT NULL AS con_osticket
           FROM compras_areas ORDER BY lower(nombre)`,
      ),
    ]);
    return { tipos: tipos.rows, cuentas: cuentas.rows, areasLista: areas.rows };
  }

  static async crearArea(body, usuarioId) {
    const nombre = limpio(body.nombre);
    if (!nombre) throw new AppError("Falta el nombre del área", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    try {
      const { rows } = await db.query(
        `INSERT INTO compras_areas (nombre, actualizado_por) VALUES ($1, $2)
         RETURNING id, nombre, activo, false AS con_osticket`,
        [nombre, usuarioId],
      );
      return rows[0];
    } catch (e) {
      if (e.code === "23505") throw new AppError(`Ya existe el área "${nombre}"`, 409);
      throw e;
    }
  }

  /** Solo las áreas sin tema de osTicket: las otras se manejan en Aprobadores. */
  static async actualizarArea(id, body, usuarioId) {
    const nombre = limpio(body.nombre);
    if (!nombre) throw new AppError("Falta el nombre del área", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    const { rows: actual } = await db.query("SELECT osticket_topic_id FROM compras_areas WHERE id = $1", [id]);
    if (!actual[0]) throw new AppError("No existe esa área", 404);
    if (actual[0].osticket_topic_id != null) {
      throw new AppError("Esa área está ligada al osTicket de Compras; se configura en Aprobadores", 400);
    }
    try {
      const { rows } = await db.query(
        `UPDATE compras_areas SET nombre = $1, activo = $2, actualizado_por = $3, actualizado_en = now()
          WHERE id = $4 RETURNING id, nombre, activo, false AS con_osticket`,
        [nombre, body.activo !== false, usuarioId, id],
      );
      return rows[0];
    } catch (e) {
      if (e.code === "23505") throw new AppError(`Ya existe el área "${nombre}"`, 409);
      throw e;
    }
  }

  static async crearTipo(body, usuarioId) {
    const nombre = limpio(body.nombre);
    if (!nombre) throw new AppError("Falta el nombre del tipo", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    try {
      const { rows } = await db.query(
        "INSERT INTO compras_tipos (nombre, actualizado_por) VALUES ($1, $2) RETURNING id, nombre, activo",
        [nombre, usuarioId],
      );
      return rows[0];
    } catch (e) {
      if (e.code === "23505") throw new AppError(`Ya existe el tipo "${nombre}"`, 409);
      throw e;
    }
  }

  /** Renombra o (des)activa un tipo; al renombrar, corrige los formatos. */
  static async actualizarTipo(id, body, usuarioId) {
    const nombre = limpio(body.nombre);
    if (!nombre) throw new AppError("Falta el nombre del tipo", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows: antes } = await cliente.query("SELECT nombre FROM compras_tipos WHERE id = $1 FOR UPDATE", [id]);
      if (!antes[0]) throw new AppError("No existe ese tipo", 404);
      const { rows } = await cliente.query(
        `UPDATE compras_tipos SET nombre = $1, activo = $2, actualizado_por = $3, actualizado_en = now()
          WHERE id = $4 RETURNING id, nombre, activo`,
        [nombre, body.activo !== false, usuarioId, id],
      );
      let formatos = 0;
      if (antes[0].nombre !== nombre) {
        ({ rowCount: formatos } = await cliente.query(
          "UPDATE compras_formatos SET clasif_tipo = $1 WHERE clasif_tipo = $2",
          [nombre, antes[0].nombre],
        ));
      }
      await cliente.query("COMMIT");
      return { ...rows[0], anterior: antes[0].nombre, formatos };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23505") throw new AppError(`Ya existe el tipo "${nombre}"`, 409);
      throw e;
    } finally {
      cliente.release();
    }
  }

  static async crearCuenta(body, usuarioId) {
    const codigo = soloDigitos(body.codigo);
    const nombre = limpio(body.nombre);
    if (!codigo) throw new AppError("Falta el número de cuenta", 400);
    if (codigo.length > 20) throw new AppError("El número de cuenta es demasiado largo", 400);
    if (!nombre) throw new AppError("Falta el nombre de la cuenta", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    try {
      const { rows } = await db.query(
        `INSERT INTO compras_cuentas (codigo, nombre, actualizado_por) VALUES ($1, $2, $3)
         RETURNING codigo, nombre, activo`,
        [codigo, nombre, usuarioId],
      );
      return rows[0];
    } catch (e) {
      if (e.code === "23505") throw new AppError(`Ya existe la cuenta ${codigo}`, 409);
      throw e;
    }
  }

  /** El número es la llave: solo cambian el nombre y si está activa. */
  static async actualizarCuenta(codigo, body, usuarioId) {
    const nombre = limpio(body.nombre);
    if (!nombre) throw new AppError("Falta el nombre de la cuenta", 400);
    if (nombre.length > 120) throw new AppError("El nombre es demasiado largo (máximo 120)", 400);
    const { rows } = await db.query(
      `UPDATE compras_cuentas SET nombre = $1, activo = $2, actualizado_por = $3, actualizado_en = now()
        WHERE codigo = $4 RETURNING codigo, nombre, activo`,
      [nombre, body.activo !== false, usuarioId, soloDigitos(codigo)],
    );
    if (!rows[0]) throw new AppError("No existe esa cuenta", 404);
    return rows[0];
  }

  /**
   * Revisa tipo y cuenta de un formato contra las listas. Lo que ya traía el
   * formato antes (capturado a mano) se respeta aunque no esté en la lista,
   * para poder corregir otros campos sin obligar a reclasificarlo.
   *
   * @param {Object} d         datos normalizados (clasif_tipo, cuenta)
   * @param {Object} anterior  el formato como estaba (o null si es nuevo)
   */
  static async validarFormato(d, anterior = null) {
    if (d.cuenta) {
      const digitos = soloDigitos(d.cuenta);
      if (digitos) d.cuenta = digitos;
    }
    const [tipo, cuenta] = await Promise.all([
      d.clasif_tipo
        ? db.query("SELECT nombre, activo FROM compras_tipos WHERE lower(nombre) = lower($1)", [d.clasif_tipo])
        : null,
      d.cuenta ? db.query("SELECT codigo, activo FROM compras_cuentas WHERE codigo = $1", [d.cuenta]) : null,
    ]);
    if (tipo) {
      const t = tipo.rows[0];
      if (t) d.clasif_tipo = t.nombre;
      const igual = anterior && anterior.clasif_tipo === d.clasif_tipo;
      if (!igual && (!t || !t.activo)) {
        throw new AppError(`El tipo "${d.clasif_tipo}" no está en la lista de Compras`, 400);
      }
    }
    if (cuenta) {
      const c = cuenta.rows[0];
      const igual = anterior && anterior.cuenta === d.cuenta;
      if (!igual && (!c || !c.activo)) {
        throw new AppError(`La cuenta ${d.cuenta} no está en la lista de Finanzas`, 400);
      }
    }
    return d;
  }
}

module.exports = CompraCatalogo;
