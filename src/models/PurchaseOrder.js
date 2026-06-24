const db = require("../config/database");

class PurchaseOrder {
  /**
   * Crear una nueva PO
   */
  static async create(data) {
    const { poNumber, cantidadPares, cantidadCartones, cfmxfDate } = data;

    const query = `
      INSERT INTO purchase_orders (po_number, cantidad_pares, cantidad_cartones, cfm_xf_date, estado)
      VALUES ($1, $2, $3, $4, 'IMPORTADA')
      RETURNING *
    `;

    const result = await db.query(query, [
      poNumber,
      cantidadPares,
      cantidadCartones,
      cfmxfDate,
    ]);

    return result.rows[0];
  }

  /**
   * Buscar PO por número
   */
  static async findByPoNumber(poNumber) {
    const query = `
      SELECT 
        id,
        po_number,
        cantidad_pares,
        cantidad_cartones,
        cfm_xf_date,
        estado,
        pares_completados,
        cartones_completados,
        creado_en,
        actualizado_en
      FROM purchase_orders
      WHERE po_number = $1
    `;

    const result = await db.query(query, [poNumber]);
    return result.rows[0];
  }

  /**
   * Buscar PO por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        po_number,
        cantidad_pares,
        cantidad_cartones,
        cfm_xf_date,
        estado,
        pares_completados,
        cartones_completados,
        creado_en,
        actualizado_en
      FROM purchase_orders
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener todas las POs con filtros
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        id,
        po_number,
        cantidad_pares,
        cantidad_cartones,
        cfm_xf_date,
        estado,
        pares_completados,
        cartones_completados,
        creado_en,
        actualizado_en
      FROM purchase_orders
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.estado) {
      query += ` AND estado = $${paramCount}`;
      values.push(filters.estado);
      paramCount++;
    }

    if (filters.poNumber) {
      query += ` AND po_number ILIKE $${paramCount}`;
      values.push(`%${filters.poNumber}%`);
      paramCount++;
    }

    if (filters.fechaInicio) {
      query += ` AND cfm_xf_date >= $${paramCount}`;
      values.push(filters.fechaInicio);
      paramCount++;
    }

    if (filters.fechaFin) {
      query += ` AND cfm_xf_date <= $${paramCount}`;
      values.push(filters.fechaFin);
      paramCount++;
    }

    query += ` ORDER BY cfm_xf_date ASC, po_number ASC`;

    if (filters.limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(filters.limit);
      paramCount++;
    }

    if (filters.offset !== undefined) {
      query += ` OFFSET $${paramCount}`;
      values.push(filters.offset);
      paramCount++;
    }

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Contar POs con filtros
   */
  static async count(filters = {}) {
    let query = `SELECT COUNT(*) as total FROM purchase_orders WHERE 1=1`;

    const values = [];
    let paramCount = 1;

    if (filters.estado) {
      query += ` AND estado = $${paramCount}`;
      values.push(filters.estado);
      paramCount++;
    }

    if (filters.poNumber) {
      query += ` AND po_number ILIKE $${paramCount}`;
      values.push(`%${filters.poNumber}%`);
      paramCount++;
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].total);
  }

  /**
   * Actualizar estado de la PO
   */
  static async updateEstado(id, estado) {
    const query = `
      UPDATE purchase_orders
      SET estado = $1, actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(query, [estado, id]);
    return result.rows[0];
  }

  /**
   * Actualizar contadores de progreso
   */
  static async updateProgress(id, data) {
    const fields = [];
    const values = [];
    let paramCount = 1;

    if (data.paresCompletados !== undefined) {
      fields.push(`pares_completados = $${paramCount}`);
      values.push(data.paresCompletados);
      paramCount++;
    }

    if (data.cartonesLigados !== undefined) {
      fields.push(`cartones_completados = $${paramCount}`);
      values.push(data.cartonesLigados);
      paramCount++;
    }

    if (fields.length === 0) {
      throw new Error("No hay campos para actualizar");
    }

    fields.push(`actualizado_en = CURRENT_TIMESTAMP`);

    values.push(id);
    const query = `
      UPDATE purchase_orders
      SET ${fields.join(", ")}
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await db.query(query, values);
    return result.rows[0];
  }

  /**
   * Obtener PO con información de cartones
   */
  static async findByIdWithCartones(id) {
    const query = `
      SELECT 
        po.id,
        po.po_number,
        po.cantidad_pares,
        po.cantidad_cartones,
        po.cfm_xf_date,
        po.estado,
        po.pares_completados,
        po.cartones_completados,
        po.creado_en,
        po.actualizado_en,
        json_agg(
          json_build_object(
            'id', c.id,
            'numero_carton', c.numero_carton,
            'sku', c.sku,
            'cantidad_pares_esperados', c.cantidad_pares_esperados,
            'cantidad_pares_escaneados', c.cantidad_pares_escaneados,
            'estado', c.estado,
            'caja_id', c.caja_id
          ) ORDER BY c.numero_carton
        ) FILTER (WHERE c.id IS NOT NULL) as cartones
      FROM purchase_orders po
      LEFT JOIN po_cartones c ON po.id = c.po_id
      WHERE po.id = $1
      GROUP BY po.id
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Verificar si una PO está completa
   */
  static async checkIfComplete(id) {
    const query = `
      SELECT 
        cantidad_pares,
        cantidad_cartones,
        pares_completados,
        cartones_completados
      FROM purchase_orders
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    const po = result.rows[0];

    if (!po) return false;

    const paresCompletos = po.pares_completados >= po.cantidad_pares;
    const cartonesCompletos = po.cartones_completados >= po.cantidad_cartones;

    return paresCompletos && cartonesCompletos;
  }

  /**
   * Obtener estadísticas de una PO
   */
  static async getEstadisticas(id) {
    const query = `
      SELECT 
        po.po_number,
        po.cantidad_pares,
        po.cantidad_cartones,
        po.pares_completados,
        po.cartones_completados,
        po.estado,
        po.es_musical,
        COUNT(DISTINCT c.numero_carton) as total_cartones_importados,
        COUNT(DISTINCT c.numero_carton) FILTER (WHERE c.estado = 'COMPLETADO') as cartones_completados_count,
        COUNT(DISTINCT c.id) as total_lineas_carton,
        SUM(c.cantidad_pares_esperados) as total_pares_esperados,
        SUM(c.cantidad_pares_escaneados) as total_pares_escaneados
      FROM purchase_orders po
      LEFT JOIN po_cartones c ON po.id = c.po_id
      WHERE po.id = $1
      GROUP BY po.id
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Bulk insert de POs
   */
  static async bulkCreate(pos) {
    const client = await db.pool.connect();
    const created = [];
    const errors = [];

    try {
      await client.query("BEGIN");

      for (const po of pos) {
        try {
          const result = await client.query(
            `INSERT INTO purchase_orders (po_number, cantidad_pares, cantidad_cartones, cfm_xf_date, estado)
             VALUES ($1, $2, $3, $4, 'IMPORTADA')
             ON CONFLICT (po_number) DO UPDATE SET
               cantidad_pares = EXCLUDED.cantidad_pares,
               cantidad_cartones = EXCLUDED.cantidad_cartones,
               cfm_xf_date = EXCLUDED.cfm_xf_date,
               actualizado_en = CURRENT_TIMESTAMP
             RETURNING *`,
            [po.poNumber, po.cantidadPares, po.cantidadCartones, po.cfmxfDate],
          );
          created.push(result.rows[0]);
        } catch (err) {
          errors.push({ po: po.poNumber, error: err.message });
        }
      }

      await client.query("COMMIT");
      return { created, errors };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = PurchaseOrder;
