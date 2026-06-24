const db = require("../config/database");

class QrUpcMapping {
  /**
   * Buscar mapeo por QR normalizado
   */
  static async findByQrNormalizado(qrNormalizado) {
    const query = `
      SELECT id, qr_code, qr_code_normalizado, upc, sincronizado_en
      FROM qr_upc_mapping
      WHERE qr_code_normalizado = $1
    `;
    const result = await db.query(query, [qrNormalizado]);
    return result.rows[0];
  }

  /**
   * Buscar todos los mapeos por UPC
   */
  static async findByUpc(upc) {
    const query = `
      SELECT id, qr_code, qr_code_normalizado, upc, sincronizado_en
      FROM qr_upc_mapping
      WHERE upc = $1
      ORDER BY sincronizado_en DESC
    `;
    const result = await db.query(query, [upc]);
    return result.rows;
  }

  /**
   * Insertar o actualizar mapeos en lote (upsert)
   * @param {Array<{qrCode: string, qrNormalizado: string, upc: string}>} mappings
   * @returns {Object} { insertados, existentes }
   */
  static async bulkUpsert(mappings) {
    if (!mappings || mappings.length === 0)
      return { insertados: 0, existentes: 0 };

    const client = await db.pool.connect();
    let insertados = 0;
    let existentes = 0;

    try {
      await client.query("BEGIN");

      for (const m of mappings) {
        const result = await client.query(
          `INSERT INTO qr_upc_mapping (qr_code, qr_code_normalizado, upc)
           VALUES ($1, $2, $3)
           ON CONFLICT (qr_code_normalizado) DO NOTHING
           RETURNING id`,
          [m.qrCode, m.qrNormalizado, m.upc],
        );

        if (result.rows.length > 0) {
          insertados++;
        } else {
          existentes++;
        }
      }

      await client.query("COMMIT");
      return { insertados, existentes };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Contar total de mapeos
   */
  static async count() {
    const result = await db.query(
      "SELECT COUNT(*) as total FROM qr_upc_mapping",
    );
    return parseInt(result.rows[0].total);
  }

  /**
   * Obtener todos con paginación
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT id, qr_code, qr_code_normalizado, upc, sincronizado_en
      FROM qr_upc_mapping
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.upc) {
      query += ` AND upc = $${paramCount}`;
      values.push(filters.upc);
      paramCount++;
    }

    if (filters.search) {
      query += ` AND (qr_code_normalizado ILIKE $${paramCount} OR upc ILIKE $${paramCount})`;
      values.push(`%${filters.search}%`);
      paramCount++;
    }

    query += ` ORDER BY sincronizado_en DESC`;

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
}

module.exports = QrUpcMapping;
