const db = require("../config/database");

/**
 * Consultas del reporte de AIMS.
 *
 * ---------------------------------------------------------------------------
 * EL ACUMULADO DEL AÑO SE CALCULA AQUÍ
 * ---------------------------------------------------------------------------
 * El libro lo saca de una tabla dinámica que suma los meses: 464% de plan AIMS
 * anual, 713 minutos de MTTR. Aquí depende de qué es cada indicador
 * (`aims_kpis.agregado`):
 *
 *   PROMEDIO   el promedio de los meses con dato
 *   RAZON      Σ numerador / Σ denominador: el plan de mantenimiento del año
 *              es máquinas cumplidas entre planeadas de todos los meses, no el
 *              promedio de doce porcentajes con bases distintas
 *   PONDERADO  MTTR y MTBF pesados por número de OT: un mes con 584 órdenes
 *              no pesa lo mismo que uno con 4
 *   ULTIMO     el plan AIMS ya es acumulado; el año es el último mes
 */

/** ¿El valor cumple la meta? null si no hay con qué comparar. */
function cumple(valor, meta, sentido) {
  if (valor == null || meta == null) return null;
  return sentido === "MENOR" ? valor <= meta : valor >= meta;
}

function acumular(agregado, valores) {
  const con = valores.filter((v) => v.valor != null);
  if (con.length === 0) return null;
  switch (agregado) {
    case "RAZON": {
      const num = con.reduce((a, v) => a + (v.numerador || 0), 0);
      const den = con.reduce((a, v) => a + (v.denominador || 0), 0);
      return den ? num / den : null;
    }
    case "PONDERADO": {
      const peso = con.reduce((a, v) => a + (v.peso || 0), 0);
      if (!peso) return con.reduce((a, v) => a + v.valor, 0) / con.length;
      return con.reduce((a, v) => a + v.valor * (v.peso || 0), 0) / peso;
    }
    case "ULTIMO":
      return con[con.length - 1].valor;
    default:
      return con.reduce((a, v) => a + v.valor, 0) / con.length;
  }
}

/** Años con datos, para el selector. */
async function anios() {
  const { rows } = await db.query(
    "SELECT DISTINCT anio FROM aims_valores ORDER BY anio DESC",
  );
  return rows.map((r) => r.anio);
}

/**
 * Los indicadores con sus meses del año, su último mes con dato y el
 * acumulado, cada uno contra su meta.
 */
async function indicadores(anio) {
  const [kpis, valores] = await Promise.all([
    db.query(
      `SELECT codigo, orden, nombre, definicion, calculo, meta_texto, meta::float, sentido,
              unidad, fuente, agregado, extra
         FROM aims_kpis ORDER BY orden`,
    ),
    db.query(
      `SELECT codigo, mes, valor::float, numerador::float, denominador::float, peso::float, detalle
         FROM aims_valores WHERE anio = $1 ORDER BY codigo, mes`,
      [anio],
    ),
  ]);

  const porKpi = new Map();
  for (const v of valores.rows) {
    if (!porKpi.has(v.codigo)) porKpi.set(v.codigo, []);
    porKpi.get(v.codigo).push(v);
  }

  return kpis.rows.map((k) => {
    const meses = porKpi.get(k.codigo) || [];
    const conDato = meses.filter((m) => m.valor != null);
    const ultimo = conDato[conDato.length - 1] || null;
    const acumulado = acumular(k.agregado, meses);
    return {
      ...k,
      meses: meses.map((m) => ({ ...m, cumple: cumple(m.valor, k.meta, k.sentido) })),
      ultimo: ultimo && {
        mes: ultimo.mes,
        valor: ultimo.valor,
        cumple: cumple(ultimo.valor, k.meta, k.sentido),
      },
      acumulado: {
        valor: acumulado,
        cumple: cumple(acumulado, k.meta, k.sentido),
      },
    };
  });
}

module.exports = { anios, indicadores, acumular, cumple };
