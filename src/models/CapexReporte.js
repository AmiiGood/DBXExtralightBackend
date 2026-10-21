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

/** Las etapas que cuentan para el avance: hasta Firmas FOAM, sin Italia. */
const ETAPAS_AVANCE = ["relacion_tecnica", "cotizacion", "rac", "layout", "hse", "firmas_foam"];

/**
 * En qué etapa va cada proyecto del bloque.
 *
 * Por cada renglón se cuentan las etapas en verde (hechas) y en amarillo (en
 * proceso), de Relación técnica a Firmas FOAM. Los renglones con TODAS las
 * etapas en gris no entran: el libro los pinta así cuando se cancelaron o se
 * pasaron a OPEX (26-MEX-03, 26-MEX-16, 26-MEX-22).
 *
 * Es el avance tal como está pintado en el libro, y el área advirtió que no
 * siempre está al día; la pantalla lo dice junto a la gráfica.
 */
async function avance() {
  const { rows } = await db.query(
    `SELECT id, fila, codigo, descripcion, notas, dueno, etapas, aprobado_foam
       FROM capex_proyectos ORDER BY fila`,
  );

  return rows
    .filter((r) => !ETAPAS_AVANCE.every((e) => r.etapas?.[e]?.estado === "GRIS"))
    .map((r) => {
      const estados = ETAPAS_AVANCE.map((e) => r.etapas?.[e]?.estado || "SIN");
      return {
        id: r.id,
        codigo: r.codigo,
        descripcion: r.descripcion,
        notas: r.notas,
        dueno: r.dueno,
        aprobadoFoam: r.aprobado_foam,
        verdes: estados.filter((s) => s === "VERDE").length,
        enProceso: estados.filter((s) => s === "AMARILLO").length,
        etapas: Object.fromEntries(ETAPAS_AVANCE.map((e, i) => [e, estados[i]])),
        fila: r.fila,
      };
    })
    .sort((a, b) => b.verdes - a.verdes || b.enProceso - a.enProceso || a.fila - b.fila);
}

/**
 * La hoja 'nuove iniziative': iniciativas y su curva de gasto por año.
 *
 * @returns {Object} { filas, anios, porAnio }  porAnio = [{ anio, total, '26-MEX-01': … }]
 */
async function iniziative() {
  const { rows } = await db.query(
    `SELECT id, fila, codigo, descripcion, owner, planta, estudios, anios, total::float
       FROM capex_iniziative ORDER BY fila`,
  );

  const anios = [...new Set(rows.flatMap((r) => Object.keys(r.anios || {})))]
    .map(Number)
    .sort((a, b) => a - b);

  const porAnio = anios.map((anio) => {
    const punto = { anio, total: 0 };
    for (const r of rows) {
      const v = Number(r.anios?.[anio] || 0);
      punto[r.codigo] = v;
      punto.total += v;
    }
    return punto;
  });

  return { filas: rows, anios, porAnio };
}

module.exports = { resumen, aprobados, trimestres, avance, iniziative, ETAPAS_AVANCE };
