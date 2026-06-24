const db = require("../config/database");

class ProductoCrocs {
  /**
   * Buscar productos por UPC (puede haber varios SKUs con el mismo UPC)
   */
  static async findByUpc(upc) {
    const query = `
      SELECT id, sku, upc, style_no, style_name, color, size, activo
      FROM productos_crocs
      WHERE upc = $1 AND activo = true
      ORDER BY sku ASC
    `;
    const result = await db.query(query, [upc]);
    return result.rows;
  }

  /**
   * Buscar producto por SKU
   */
  static async findBySku(sku) {
    const query = `
      SELECT id, sku, upc, style_no, style_name, color, size, activo
      FROM productos_crocs
      WHERE sku = $1
    `;
    const result = await db.query(query, [sku]);
    return result.rows[0];
  }

  /**
   * Insertar o actualizar productos en lote desde Excel
   * @param {Array} productos - Array de {sku, upc, styleNo, styleName, color, size}
   * @returns {Object} { nuevos, actualizados, errores }
   */
  static async bulkUpsert(productos) {
    if (!productos || productos.length === 0) {
      return { nuevos: 0, actualizados: 0, errores: 0 };
    }

    const client = await db.pool.connect();
    let nuevos = 0;
    let actualizados = 0;
    let errores = 0;

    try {
      await client.query("BEGIN");

      for (const p of productos) {
        try {
          const result = await client.query(
            `INSERT INTO productos_crocs (sku, upc, style_no, style_name, color, size)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (sku, upc) DO UPDATE SET
               style_no = EXCLUDED.style_no,
               style_name = EXCLUDED.style_name,
               color = EXCLUDED.color,
               size = EXCLUDED.size,
               actualizado_en = CURRENT_TIMESTAMP
             RETURNING (xmax = 0) as is_insert`,
            [
              p.sku,
              p.upc,
              p.styleNo || null,
              p.styleName || null,
              p.color || null,
              p.size || null,
            ],
          );

          if (result.rows[0].is_insert) {
            nuevos++;
          } else {
            actualizados++;
          }
        } catch (err) {
          console.error(`Error insertando producto SKU ${p.sku}:`, err.message);
          errores++;
        }
      }

      await client.query("COMMIT");
      return { nuevos, actualizados, errores };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Obtener todos los productos con filtros
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT id, sku, upc, style_no, style_name, color, size, activo, creado_en
      FROM productos_crocs
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
      query += ` AND (sku ILIKE $${paramCount} OR upc ILIKE $${paramCount} OR style_name ILIKE $${paramCount} OR style_no ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    if (filters.upc) {
      query += ` AND upc = $${paramCount}`;
      values.push(filters.upc);
      paramCount++;
    }

    query += ` ORDER BY style_name ASC, sku ASC`;

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
   * Contar productos con filtros
   */
  static async count(filters = {}) {
    let query = `SELECT COUNT(*) as total FROM productos_crocs WHERE 1=1`;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (sku ILIKE $${paramCount} OR upc ILIKE $${paramCount} OR style_name ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    const result = await db.query(query, values);
    return parseInt(result.rows[0].total);
  }

  /**
   * Obtener UPCs únicos
   */
  static async getDistinctUpcs() {
    const query = `
      SELECT DISTINCT upc, style_name, color
      FROM productos_crocs
      WHERE activo = true
      ORDER BY style_name ASC
    `;
    const result = await db.query(query);
    return result.rows;
  }
}

module.exports = ProductoCrocs;
