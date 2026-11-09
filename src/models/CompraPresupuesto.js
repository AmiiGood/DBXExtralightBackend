const db = require("../config/database");
const tipoCambio = require("../services/tipoCambio.service");
const { AppError } = require("../utils/errorHandler");

/**
 * Presupuesto de Compras por área.
 *
 * Ver migrations/2026-11-09_compras_solicitudes_06_presupuestos.sql. En corto:
 *
 *   - Un monto por área, año y mes; el anual es la suma.
 *   - Lo que no se gasta pasa al mes siguiente dentro del año:
 *       disponible del mes = presupuesto de enero a ese mes − ejercido de enero a ese mes
 *   - Lo ejercido son las solicitudes ELEGIDAS, por el monto que se guardó al
 *     elegir (sin IVA y en pesos), en el mes en que se eligieron.
 *   - Rebasar no bloquea: el disponible queda en negativo.
 */

const redondo = (n) => Math.round(n * 100) / 100;

/** Año y mes de hoy en hora de México (la BD de producción está en GMT). */
async function hoyMexico(cliente = db) {
  const { rows } = await cliente.query(
    `SELECT extract(year FROM now() AT TIME ZONE 'America/Mexico_City')::int AS anio,
            extract(month FROM now() AT TIME ZONE 'America/Mexico_City')::int AS mes`,
  );
  return rows[0];
}

async function ivaTasa(cliente = db) {
  const { rows } = await cliente.query("SELECT iva_tasa::float AS iva FROM compras_config WHERE id = 1");
  return rows[0]?.iva ?? 0.16;
}

/**
 * Cuánto descuenta del presupuesto una opción: sin IVA y en pesos.
 * @returns {{ monto: number|null, tipoCambio: number|null }}  monto null si es en
 *          dólares y no hay tipo de cambio
 */
function montoParaPresupuesto({ total, moneda, incluyeIva }, { tc, iva }) {
  let monto = incluyeIva ? total / (1 + iva) : total;
  if (moneda === "USD") {
    if (!tc) return { monto: null, tipoCambio: null };
    monto *= tc;
    return { monto: redondo(monto), tipoCambio: tc };
  }
  return { monto: redondo(monto), tipoCambio: null };
}

class CompraPresupuesto {
  static hoyMexico = hoyMexico;
  static ivaTasa = ivaTasa;
  static montoParaPresupuesto = montoParaPresupuesto;

  /**
   * El saldo de un área en un mes.
   *
   * @returns {Object} {
   *   configurado      ¿tiene algo capturado ese año?
   *   presupuestoMes   lo asignado a ese mes
   *   disponibleMes    lo asignado de enero a ese mes menos lo ejercido de enero a ese mes
   *   presupuestoAnual, ejercidoAnual, disponibleAnual
   *   sinTipoCambio    elecciones en dólares que no se pudieron convertir (no cuentan)
   * }
   */
  static async saldo(areaId, anio, mes, cliente = db) {
    const { rows } = await cliente.query(
      `WITH p AS (
         SELECT mes, monto FROM compras_presupuestos WHERE compras_area_id = $1 AND anio = $2
       ), e AS (
         SELECT presupuesto_mes AS mes, sum(monto_presupuesto) AS monto,
                count(*) FILTER (WHERE monto_presupuesto IS NULL) AS sin_tc
           FROM compras_solicitudes
          WHERE compras_area_id = $1 AND presupuesto_anio = $2 AND estado = 'ELEGIDA'
          GROUP BY presupuesto_mes
       )
       SELECT coalesce((SELECT sum(monto) FROM p WHERE mes = $3), 0)::float AS presupuesto_mes,
              coalesce((SELECT sum(monto) FROM p WHERE mes <= $3), 0)::float AS presupuesto_hasta,
              coalesce((SELECT sum(monto) FROM e WHERE mes <= $3), 0)::float AS ejercido_hasta,
              coalesce((SELECT sum(monto) FROM e WHERE mes = $3), 0)::float AS ejercido_mes,
              coalesce((SELECT sum(monto) FROM p), 0)::float AS presupuesto_anual,
              coalesce((SELECT sum(monto) FROM e), 0)::float AS ejercido_anual,
              coalesce((SELECT sum(sin_tc) FROM e), 0)::int AS sin_tc,
              EXISTS (SELECT 1 FROM p WHERE monto > 0) AS configurado`,
      [areaId, anio, mes],
    );
    const r = rows[0];
    return {
      anio,
      mes,
      configurado: r.configurado,
      presupuestoMes: r.presupuesto_mes,
      ejercidoMes: r.ejercido_mes,
      disponibleMes: redondo(r.presupuesto_hasta - r.ejercido_hasta),
      presupuestoAnual: r.presupuesto_anual,
      ejercidoAnual: r.ejercido_anual,
      disponibleAnual: redondo(r.presupuesto_anual - r.ejercido_anual),
      sinTipoCambio: r.sin_tc,
    };
  }

  /** El saldo del mes en curso del área de una solicitud. */
  static async saldoActual(areaId) {
    const { anio, mes } = await hoyMexico();
    return this.saldo(areaId, anio, mes);
  }

  /**
   * Lo que descontaría cada opción de una cotización si se eligiera hoy, y
   * cómo quedaría el área.
   *
   * @returns {Object} { saldo, tipoCambio, iva, opciones: { [opcionId]: { monto, quedaMes, quedaAnio, rebasa, sinTipoCambio } } }
   */
  static async impacto(cotizacion, areaId) {
    const [saldo, iva, tc] = await Promise.all([this.saldoActual(areaId), ivaTasa(), tipoCambio.ultimo()]);
    const opciones = {};
    for (const o of cotizacion?.opciones || []) {
      const { monto } = montoParaPresupuesto(
        { total: o.total, moneda: o.moneda, incluyeIva: cotizacion.incluye_iva },
        { tc: tc?.valor, iva },
      );
      opciones[o.id] =
        monto == null
          ? { monto: null, sinTipoCambio: true }
          : {
              monto,
              quedaMes: redondo(saldo.disponibleMes - monto),
              quedaAnio: redondo(saldo.disponibleAnual - monto),
              // Sin presupuesto capturado no hay contra qué rebasar
              rebasa: saldo.configurado && saldo.disponibleMes - monto < 0,
            };
    }
    return { saldo, tipoCambio: tc ? { valor: tc.valor, fecha: tc.fecha } : null, iva, opciones };
  }

  /**
   * Todas las áreas en un año: lo presupuestado y lo ejercido por mes, para la
   * pantalla de Presupuestos.
   */
  static async resumen(anio) {
    const hoy = await hoyMexico();
    const [{ rows: areas }, { rows: presup }, { rows: ejercido }] = await Promise.all([
      db.query(
        `SELECT ca.id, ca.nombre, ca.osticket_topic_id, ca.activo, g.nombre_completo AS gerente_nombre
           FROM compras_areas ca LEFT JOIN usuarios g ON g.id = ca.gerente_id
          ORDER BY ca.nombre`,
      ),
      db.query(`SELECT compras_area_id, mes, monto::float AS monto FROM compras_presupuestos WHERE anio = $1`, [anio]),
      db.query(
        `SELECT compras_area_id, presupuesto_mes AS mes, sum(monto_presupuesto)::float AS monto,
                count(*)::int AS elecciones, count(*) FILTER (WHERE monto_presupuesto IS NULL)::int AS sin_tc
           FROM compras_solicitudes
          WHERE presupuesto_anio = $1 AND estado = 'ELEGIDA'
          GROUP BY compras_area_id, presupuesto_mes`,
        [anio],
      ),
    ]);
    // Mes contra el que se mide el disponible: el actual si es este año; diciembre si ya pasó
    const mesCorte = anio < hoy.anio ? 12 : anio > hoy.anio ? 0 : hoy.mes;

    return {
      anio,
      hoy,
      mesCorte,
      areas: areas.map((a) => {
        const meses = Array.from({ length: 12 }, (_, i) => {
          const p = presup.find((x) => x.compras_area_id === a.id && x.mes === i + 1);
          const e = ejercido.find((x) => x.compras_area_id === a.id && x.mes === i + 1);
          return { mes: i + 1, presupuesto: p?.monto || 0, ejercido: e?.monto || 0, elecciones: e?.elecciones || 0 };
        });
        const suma = (k, hasta = 12) => redondo(meses.slice(0, hasta).reduce((s, m) => s + m[k], 0));
        return {
          ...a,
          meses,
          presupuestoAnual: suma("presupuesto"),
          ejercidoAnual: suma("ejercido"),
          disponibleAnual: redondo(suma("presupuesto") - suma("ejercido")),
          disponibleMes: mesCorte ? redondo(suma("presupuesto", mesCorte) - suma("ejercido", mesCorte)) : null,
          sinTipoCambio: ejercido.filter((x) => x.compras_area_id === a.id).reduce((s, x) => s + x.sin_tc, 0),
        };
      }),
    };
  }

  /** Las compras elegidas de un área en un año: lo que se le descontó. */
  static async elecciones(areaId, anio) {
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.osticket_numero, s.presupuesto_mes AS mes,
              to_char(s.elegido_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS elegido_en,
              s.monto_elegido::float AS monto_elegido, s.moneda_elegida,
              s.monto_presupuesto::float AS monto_presupuesto, s.tipo_cambio_presupuesto::float AS tipo_cambio,
              o.proveedor, us.nombre_completo AS solicitante_nombre
         FROM compras_solicitudes s
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN compras_cotizacion_opciones o ON o.id = s.opcion_elegida_id
        WHERE s.compras_area_id = $1 AND s.presupuesto_anio = $2 AND s.estado = 'ELEGIDA'
        ORDER BY s.elegido_en DESC`,
      [areaId, anio],
    );
    return rows;
  }

  /**
   * Guarda lo capturado en pantalla: por área, los 12 meses de un año.
   * @param {Array} filas [{ areaId, meses: [12 montos] }]
   */
  static async guardar(anio, filas, usuarioId) {
    const a = Number(anio);
    if (!Number.isInteger(a) || a < 2020 || a > 2100) throw new AppError("Año inválido", 400);
    if (!Array.isArray(filas) || filas.length === 0) throw new AppError("No hay nada que guardar", 400);

    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      let cambios = 0;
      for (const f of filas) {
        const areaId = Number(f.areaId);
        if (!Number.isInteger(areaId) || !Array.isArray(f.meses) || f.meses.length !== 12) {
          throw new AppError("Cada área lleva sus 12 meses", 400);
        }
        for (let m = 0; m < 12; m++) {
          const v = f.meses[m] === "" || f.meses[m] == null ? 0 : Number(String(f.meses[m]).replace(/[$,\s]/g, ""));
          if (!Number.isFinite(v) || v < 0) throw new AppError(`Monto inválido en el mes ${m + 1}`, 400);
          const r = await cliente.query(
            `INSERT INTO compras_presupuestos (compras_area_id, anio, mes, monto, actualizado_por)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (compras_area_id, anio, mes) DO UPDATE
               SET monto = EXCLUDED.monto, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
               WHERE compras_presupuestos.monto IS DISTINCT FROM EXCLUDED.monto`,
            [areaId, a, m + 1, redondo(v), usuarioId],
          );
          cambios += r.rowCount;
        }
      }
      await cliente.query("COMMIT");
      return { anio: a, cambios };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23503") throw new AppError("Una de las áreas no existe", 400);
      throw e;
    } finally {
      cliente.release();
    }
  }
}

module.exports = CompraPresupuesto;
