const db = require("../config/database");

class Carton {
  /**
   * Crear un nuevo cartón
   */
  static async create(data) {
    const { numeroCarton, sku, cantidadParesEsperados, poId } = data;

    const query = `
      INSERT INTO po_cartones (po_id, numero_carton, sku, cantidad_pares_esperados, estado)
      VALUES ($1, $2, $3, $4, 'PENDIENTE')
      RETURNING *
    `;

    const result = await db.query(query, [
      poId,
      numeroCarton,
      sku,
      cantidadParesEsperados,
    ]);

    return result.rows[0];
  }

  /**
   * Buscar cartón por numero_carton (puede haber múltiples si es MUSICAL)
   */
  static async findByNumeroCarton(numeroCarton) {
    const query = `
      SELECT 
        c.*,
        po.po_number,
        po.estado as po_estado,
        po.es_musical
      FROM po_cartones c
      LEFT JOIN purchase_orders po ON c.po_id = po.id
      WHERE c.numero_carton = $1
      ORDER BY c.id
    `;

    const result = await db.query(query, [numeroCarton]);
    return result.rows;
  }

  /**
   * Buscar cartón por ID único
   */
  static async findById(id) {
    const query = `
      SELECT 
        c.*,
        po.po_number,
        po.estado as po_estado,
        po.es_musical
      FROM po_cartones c
      LEFT JOIN purchase_orders po ON c.po_id = po.id
      WHERE c.id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener todos los cartones de una PO
   */
  static async findByPoId(poId, filters = {}) {
    let query = `
      SELECT 
        c.*,
        po.po_number,
        po.es_musical
      FROM po_cartones c
      LEFT JOIN purchase_orders po ON c.po_id = po.id
      WHERE c.po_id = $1
    `;

    const values = [poId];
    let paramCount = 2;

    if (filters.estado) {
      query += ` AND c.estado = $${paramCount}`;
      values.push(filters.estado);
      paramCount++;
    }

    query += ` ORDER BY c.numero_carton, c.id`;

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Actualizar estado del cartón
   */
  static async updateEstado(id, estado) {
    const query = `
      UPDATE po_cartones
      SET estado = $1, actualizado_en = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;

    const result = await db.query(query, [estado, id]);
    return result.rows[0];
  }

  /**
   * Ligar cartón con caja (para MONO SKU)
   */
  static async ligarCaja(numeroCarton, cajaId) {
    const query = `
      UPDATE po_cartones
      SET 
        caja_id = $1,
        estado = 'COMPLETADO',
        actualizado_en = CURRENT_TIMESTAMP
      WHERE numero_carton = $2
      RETURNING *
    `;

    const result = await db.query(query, [cajaId, numeroCarton]);
    return result.rows[0];
  }

  /**
   * Verificar si un numero_carton es MUSICAL (tiene múltiples SKUs)
   */
  static async isMusicale(numeroCarton) {
    const query = `
      SELECT COUNT(DISTINCT sku) as sku_count
      FROM po_cartones
      WHERE numero_carton = $1
    `;

    const result = await db.query(query, [numeroCarton]);
    return parseInt(result.rows[0].sku_count) > 1;
  }

  /**
   * Obtener información completa del cartón (incluyendo SKUs)
   */
  static async getCartonInfo(numeroCarton) {
    const query = `
      SELECT 
        c.numero_carton,
        c.po_id,
        po.po_number,
        po.es_musical,
        json_agg(
          json_build_object(
            'id', c.id,
            'sku', c.sku,
            'cantidad_pares_esperados', c.cantidad_pares_esperados,
            'cantidad_pares_escaneados', c.cantidad_pares_escaneados,
            'estado', c.estado,
            'caja_id', c.caja_id
          ) ORDER BY c.id
        ) as skus
      FROM po_cartones c
      LEFT JOIN purchase_orders po ON c.po_id = po.id
      WHERE c.numero_carton = $1
      GROUP BY c.numero_carton, c.po_id, po.po_number, po.es_musical
    `;

    const result = await db.query(query, [numeroCarton]);
    return result.rows[0];
  }

  /**
   * Contar cartones por PO y estado
   */
  static async countByPoAndEstado(poId, estado) {
    const query = `
      SELECT COUNT(DISTINCT numero_carton) as total
      FROM po_cartones
      WHERE po_id = $1 AND estado = $2
    `;

    const result = await db.query(query, [poId, estado]);
    return parseInt(result.rows[0].total);
  }

  /**
   * Bulk insert de cartones
   */
  static async bulkCreate(cartones) {
    const client = await db.pool.connect();
    const created = [];
    const errors = [];

    try {
      await client.query("BEGIN");

      for (const carton of cartones) {
        try {
          const result = await client.query(
            `INSERT INTO po_cartones (po_id, numero_carton, sku, cantidad_pares_esperados, estado)
             VALUES ($1, $2, $3, $4, 'PENDIENTE')
             RETURNING *`,
            [
              carton.poId,
              carton.cartonId, // Usar cartonId del parser
              carton.sku,
              carton.cantidadPorCarton, // Usar cantidadPorCarton del parser
            ],
          );
          created.push(result.rows[0]);
        } catch (err) {
          errors.push({ cartonId: carton.cartonId, error: err.message });
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

  /**
   * Obtener cartones pendientes de una PO
   */
  static async getPendientesByPo(poId) {
    const query = `
      SELECT DISTINCT numero_carton, po.es_musical
      FROM po_cartones c
      LEFT JOIN purchase_orders po ON c.po_id = po.id
      WHERE c.po_id = $1 AND c.estado = 'PENDIENTE'
      ORDER BY numero_carton
    `;

    const result = await db.query(query, [poId]);
    return result.rows;
  }

  /**
   * Verificar si todos los SKUs de un cartón MUSICAL están completos
   */
  static async checkMusicalComplete(numeroCarton) {
    const query = `
      SELECT 
        COUNT(*) as total_skus,
        COUNT(*) FILTER (WHERE estado = 'COMPLETADO') as skus_completados
      FROM po_cartones
      WHERE numero_carton = $1
    `;

    const result = await db.query(query, [numeroCarton]);
    const { total_skus, skus_completados } = result.rows[0];

    return parseInt(total_skus) === parseInt(skus_completados);
  }

  /**
   * Marcar todos los SKUs de un cartón MUSICAL como completados
   */
  static async completeMusical(numeroCarton) {
    const query = `
      UPDATE po_cartones
      SET estado = 'COMPLETADO', actualizado_en = CURRENT_TIMESTAMP
      WHERE numero_carton = $1
      RETURNING *
    `;

    const result = await db.query(query, [numeroCarton]);
    return result.rows;
  }
}

module.exports = Carton;
