const db = require("../config/database");

/**
 * Datos del Tablero de Compras (para Dirección).
 *
 * Mientras se usa el formato en papel, el gasto autorizado son los formatos
 * capturados (compras_formatos). Cuando el flujo con firmas esté en el
 * sistema, aquí se cambia la fuente y la pantalla queda igual.
 *
 * Todo sale en pesos y en dólares. Los dólares de un formato en pesos (y los
 * pesos de uno en dólares) usan el FIX de Banxico del día del formato o el
 * último publicado antes. El presupuesto está en pesos; en dólares se pasa con
 * el FIX más reciente.
 *
 * Grupos de cuenta (migración 11): renglones del P&L de Finanzas, como
 * MANUTENZIONE, con el concepto de cada cuenta. Una cuenta puede estar en
 * varios grupos.
 *
 * Las agrupaciones (por área, por mes, por tipo, por grupo) las hace la pantalla: son
 * pocos renglones y así cambiar de moneda o de área no pide nada al servidor.
 */
const SERIE_FIX = "SF43718";

class CompraTablero {
  /**
   * @param {String} desde  YYYY-MM-DD
   * @param {String} hasta  YYYY-MM-DD
   */
  static async datos(desde, hasta) {
    const [formatos, presupuesto, areas, tc, grupos] = await Promise.all([
      db.query(
        `SELECT f.id, to_char(f.fecha, 'YYYY-MM-DD') AS fecha, f.ticket,
                f.compras_area_id AS area_id, ca.nombre AS area_nombre,
                f.requerimiento, f.clasif_tipo, f.cuenta, cc.nombre AS cuenta_nombre, f.centro_costos,
                f.monto::float AS monto, f.moneda,
                tc.valor::float AS tipo_cambio,
                CASE WHEN f.moneda = 'MXN' THEN f.monto::float
                     WHEN tc.valor IS NOT NULL THEN round(f.monto * tc.valor, 2)::float END AS monto_mxn,
                CASE WHEN f.moneda = 'USD' THEN f.monto::float
                     WHEN tc.valor IS NOT NULL THEN round(f.monto / tc.valor, 2)::float END AS monto_usd,
                nullif(f.autorizo_gerente, '') IS NOT NULL   AS firmo_gerente,
                nullif(f.autorizo_direccion, '') IS NOT NULL AS firmo_direccion,
                (nullif(f.autorizo_gerente, '') IS NOT NULL AND nullif(f.autorizo_compras, '') IS NOT NULL
                 AND nullif(f.autorizo_direccion, '') IS NOT NULL AND nullif(f.autorizo_finanzas, '') IS NOT NULL) AS completo
           FROM compras_formatos f
           JOIN compras_areas ca ON ca.id = f.compras_area_id
           LEFT JOIN compras_cuentas cc ON cc.codigo = f.cuenta
           -- El FIX del día o el último antes; si el formato es más viejo que
           -- el primer FIX guardado, el más cercano después (mejor que dejarlo fuera)
           LEFT JOIN LATERAL (
             SELECT valor FROM tipos_cambio
              WHERE serie = $3
              ORDER BY (fecha > f.fecha), abs(fecha - f.fecha) LIMIT 1
           ) tc ON true
          WHERE f.fecha BETWEEN $1 AND $2
          ORDER BY f.fecha`,
        [desde, hasta, SERIE_FIX],
      ),
      // Presupuesto de los meses que toca el periodo (completos)
      db.query(
        `SELECT p.compras_area_id AS area_id, sum(p.monto)::float AS monto_mxn
           FROM compras_presupuestos p
          WHERE make_date(p.anio, p.mes, 1) BETWEEN date_trunc('month', $1::date) AND date_trunc('month', $2::date)
          GROUP BY p.compras_area_id`,
        [desde, hasta],
      ),
      db.query("SELECT id, nombre FROM compras_areas WHERE activo ORDER BY nombre"),
      db.query(
        `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, valor::float AS valor
           FROM tipos_cambio WHERE serie = $1 ORDER BY fecha DESC LIMIT 1`,
        [SERIE_FIX],
      ),
      db.query(
        `SELECT g.grupo, g.codigo, g.concepto, c.nombre AS cuenta_nombre
           FROM compras_grupos_cuenta g
           JOIN compras_cuentas c ON c.codigo = g.codigo
          ORDER BY g.grupo_orden, g.grupo, g.codigo`,
      ),
    ]);

    return {
      desde,
      hasta,
      tipoCambio: tc.rows[0] || null,
      formatos: formatos.rows,
      presupuesto: presupuesto.rows,
      areas: areas.rows,
      gruposCuenta: grupos.rows,
    };
  }
}

module.exports = CompraTablero;
