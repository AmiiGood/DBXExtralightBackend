const db = require("../config/database");

/**
 * Catálogos y consultas del módulo Carga Masiva de Artículos
 * (generación del archivo "ARTICLES MASSIVE LOAD").
 */
class ArticuloMassive {
  /**
   * Obtener todos los catálogos que necesita el módulo en una sola llamada.
   */
  static async getCatalogos() {
    const [colores, estilos, unfin, strap, tallas] = await Promise.all([
      db.query(
        `SELECT codigo, nombre FROM cat_colores WHERE activo = true ORDER BY codigo`,
      ),
      db.query(
        `SELECT codigo, nombre, corrida_tallas, obsoleto, familia
         FROM cat_estilos WHERE activo = true ORDER BY obsoleto, nombre`,
      ),
      db.query(
        `SELECT id, codigo, nombre, nota, obsoleto, familia_base
         FROM cat_unfin WHERE activo = true ORDER BY obsoleto, nombre`,
      ),
      db.query(
        `SELECT id, codigo, nombre, nota, obsoleto, familia_base
         FROM cat_strap WHERE activo = true ORDER BY obsoleto, nombre`,
      ),
      db.query(
        `SELECT talla, talla_display, sufijo_unfin, talla_strap, sufijo_strap,
                qty_pares, qty_strap, es_kids, orden
         FROM cat_tallas_equivalencias WHERE activo = true ORDER BY orden`,
      ),
    ]);

    return {
      colores: colores.rows,
      estilos: estilos.rows,
      unfin: unfin.rows,
      strap: strap.rows,
      tallas: tallas.rows,
    };
  }

  /**
   * Buscar productos del Avery (productos_crocs) por lista de SKUs.
   * Devuelve también los SKUs solicitados que no existen.
   */
  static async buscarPorSkus(skus) {
    const result = await db.query(
      `SELECT sku, upc, style_no, style_name, color, size
       FROM productos_crocs
       WHERE sku = ANY($1) AND activo = true
       ORDER BY sku`,
      [skus],
    );

    const encontrados = new Set(result.rows.map((r) => r.sku));
    const noEncontrados = skus.filter((s) => !encontrados.has(s));
    return { productos: result.rows, noEncontrados };
  }

  /**
   * Buscar productos del Avery por estilo + color (todas las tallas cargadas).
   */
  static async buscarPorEstiloColor(styleNo, color) {
    const result = await db.query(
      `SELECT p.sku, p.upc, p.style_no, p.style_name, p.color, p.size
       FROM productos_crocs p
       LEFT JOIN cat_tallas_equivalencias t ON t.talla = p.size
       WHERE p.style_no = $1 AND p.color = $2 AND p.activo = true
       ORDER BY COALESCE(t.orden, 999), p.sku`,
      [styleNo, color],
    );
    return result.rows;
  }

  /**
   * Alta/actualización rápida de un color en el catálogo.
   */
  static async upsertColor(codigo, nombre) {
    const result = await db.query(
      `INSERT INTO cat_colores (codigo, nombre)
       VALUES ($1, $2)
       ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, activo = true
       RETURNING codigo, nombre, (xmax = 0) AS is_insert`,
      [codigo, nombre],
    );
    return result.rows[0];
  }
}

module.exports = ArticuloMassive;
