const db = require("../config/database");

/**
 * Consultas del reporte de CAPEX.
 *
 * ---------------------------------------------------------------------------
 * SOLO LO QUE TIENE FIRMAS FOAM EN VERDE
 * ---------------------------------------------------------------------------
 * Firmas FOAM es la última etapa del proceso interno; después solo quedan las
 * firmas de Italia, que no entran al reporte. El área pidió enfocarse en eso y
 * nada más porque el resto del avance en el libro no está al día. El avance de
 * todos los demás proyectos se guarda igual (`capex_proyectos.etapas`), por si
 * más adelante se quiere enseñar.
 *
 * ---------------------------------------------------------------------------
 * SE CUENTAN RENGLONES, NO CÓDIGOS
 * ---------------------------------------------------------------------------
 * Un código puede tener varios renglones: 26-MEX-05 'Wood audit' son seis
 * sub-proyectos con su propio monto y su propio avance, y de ellos solo
 * 'Refuerzo estructural' tiene firmas FOAM. Contar códigos lo daría como
 * aprobado completo.
 *
 * El gastado es el "Tot. Gastado" del libro; si viene vacío se suma de los
 * cuatro trimestres.
 */

const GASTADO = `COALESCE(total_gastado,
  NULLIF(COALESCE(gasto_q1,0) + COALESCE(gasto_q2,0) + COALESCE(gasto_q3,0) + COALESCE(gasto_q4,0), 0))`;

/** Totales del bloque y de lo aprobado. */
async function resumen() {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int                                          AS renglones,
            COUNT(*) FILTER (WHERE aprobado_foam)::int             AS aprobados,
            COALESCE(SUM(monto), 0)::float                         AS presupuesto,
            COALESCE(SUM(monto) FILTER (WHERE aprobado_foam), 0)::float AS monto_aprobado,
            COALESCE(SUM(${GASTADO}) FILTER (WHERE aprobado_foam), 0)::float AS gastado_aprobado,
            MAX(bloque)                                            AS bloque
       FROM capex_proyectos`,
  );
  const r = rows[0];
  return {
    ...r,
    porEjercer: r.monto_aprobado - r.gastado_aprobado,
    pctPresupuesto: r.presupuesto ? r.monto_aprobado / r.presupuesto : null,
  };
}

/** Los proyectos con firmas FOAM, en el orden del libro. */
async function aprobados() {
  const { rows } = await db.query(
    `SELECT id, fila, codigo, descripcion, dueno, notas,
            monto::float, monto_texto, monto_relacion_tecnica::float, monto_final::float,
            gasto_q1::float, gasto_q2::float, gasto_q3::float, gasto_q4::float,
            notas_gasto, ${GASTADO}::float AS gastado
       FROM capex_proyectos
      WHERE aprobado_foam
      ORDER BY fila`,
  );
  return rows;
}

/** Gasto por trimestre de lo aprobado. */
async function trimestres() {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(gasto_q1), 0)::float AS q1,
            COALESCE(SUM(gasto_q2), 0)::float AS q2,
            COALESCE(SUM(gasto_q3), 0)::float AS q3,
            COALESCE(SUM(gasto_q4), 0)::float AS q4
       FROM capex_proyectos WHERE aprobado_foam`,
  );
  const t = rows[0];
  return ["q1", "q2", "q3", "q4"].map((q) => ({ trimestre: q.toUpperCase(), gasto: t[q] }));
}

module.exports = { resumen, aprobados, trimestres };
