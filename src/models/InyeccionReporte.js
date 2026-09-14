const db = require("../config/database");

/**
 * Consultas de los reportes de Producción Inyección.
 *
 * Reproducen las páginas "Inj" e "Inj 2" del Power BI:
 *   Inj    combo Producción/Scrap + %Scrap por BU, 4 tarjetas de %Scrap
 *   Inj 2  combo Producción/%Scrap por máquina + pastel de Producción por BU
 *
 * %Scrap = SUM(scrap) / SUM(produccion), igual que la medida DAX del reporte.
 *
 * Se consulta iny_produccion directo y no la vista v_iny_produccion: la BU ya
 * viene desnormalizada en el renglón, así que las agregaciones no necesitan
 * ningún JOIN salvo el de máquina.
 */

const AGRUPACIONES = ["anio", "semestre", "trimestre", "mes", "semana", "fecha"];

/** Tipos de periodo que se pueden comparar entre sí. */
const TIPOS_PERIODO = ["mes", "trimestre", "semestre", "anio"];

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Convierte un periodo (tipo + año + número) al rango de fechas que abarca.
 *
 * Se calcula aquí y no en el SQL para que la comparación A vs B use exactamente
 * el mismo criterio de corte en las dos mitades.
 *
 * @returns {{desde: String, hasta: String, etiqueta: String}}
 */
function rangoPeriodo(tipo, anio, numero) {
  const y = Number(anio);
  const n = Number(numero) || 1;
  let mesInicio;
  let mesesQueDura;
  let etiqueta;

  switch (tipo) {
    case "trimestre":
      mesInicio = (n - 1) * 3 + 1;
      mesesQueDura = 3;
      etiqueta = `T${n} ${y}`;
      break;
    case "semestre":
      mesInicio = (n - 1) * 6 + 1;
      mesesQueDura = 6;
      etiqueta = `S${n} ${y}`;
      break;
    case "anio":
      mesInicio = 1;
      mesesQueDura = 12;
      etiqueta = `${y}`;
      break;
    case "mes":
    default:
      mesInicio = n;
      mesesQueDura = 1;
      etiqueta = `${MESES[n - 1]} ${y}`;
      break;
  }

  const mesFin = mesInicio + mesesQueDura - 1;
  // Día 0 del mes siguiente = último día del mes que interesa
  const ultimoDia = new Date(Date.UTC(y, mesFin, 0)).getUTCDate();
  const dd = (v) => String(v).padStart(2, "0");

  return {
    desde: `${y}-${dd(mesInicio)}-01`,
    hasta: `${y}-${dd(mesFin)}-${dd(ultimoDia)}`,
    etiqueta,
  };
}

/**
 * Arma el WHERE compartido por todas las consultas.
 * Devuelve { where, values } para concatenar en cada query.
 */
function construirFiltro(filtros = {}, desde = 1) {
  const cond = [];
  const values = [];
  let i = desde;

  if (filtros.fechaInicio) {
    cond.push(`p.fecha >= $${i++}`);
    values.push(filtros.fechaInicio);
  }
  if (filtros.fechaFin) {
    cond.push(`p.fecha <= $${i++}`);
    values.push(filtros.fechaFin);
  }
  if (filtros.anio) {
    cond.push(`EXTRACT(YEAR FROM p.fecha) = $${i++}`);
    values.push(filtros.anio);
  }
  if (filtros.mes) {
    cond.push(`EXTRACT(MONTH FROM p.fecha) = $${i++}`);
    values.push(filtros.mes);
  }
  if (filtros.semana) {
    cond.push(`EXTRACT(WEEK FROM p.fecha) = $${i++}`);
    values.push(filtros.semana);
  }
  if (filtros.trimestre) {
    cond.push(`EXTRACT(QUARTER FROM p.fecha) = $${i++}`);
    values.push(filtros.trimestre);
  }
  if (filtros.semestre) {
    // 1 = enero-junio, 2 = julio-diciembre
    cond.push(`(CASE WHEN EXTRACT(MONTH FROM p.fecha) <= 6 THEN 1 ELSE 2 END) = $${i++}`);
    values.push(filtros.semestre);
  }
  if (Array.isArray(filtros.bu) && filtros.bu.length > 0) {
    cond.push(`p.bu_reporte = ANY($${i++})`);
    values.push(filtros.bu);
  }

  return {
    where: cond.length ? `WHERE ${cond.join(" AND ")}` : "",
    values,
    siguiente: i,
  };
}

/**
 * Expresión SQL del eje temporal.
 *
 * El periodo SIEMPRE lleva el año: agrupando solo por número de mes, enero de
 * 2025 y enero de 2026 caerían en el mismo punto de la gráfica. En el Power BI
 * eso no pasa porque el eje es la jerarquía Año → Mes → Semana.
 */
function ejeTemporal(agrupar) {
  switch (agrupar) {
    case "anio":
      return {
        sel: `EXTRACT(YEAR FROM p.fecha)::int::text`,
        etiqueta: `EXTRACT(YEAR FROM p.fecha)::int::text`,
      };
    case "semana":
      return {
        sel: `EXTRACT(YEAR FROM p.fecha)::int || '-S' || lpad(EXTRACT(WEEK FROM p.fecha)::int::text, 2, '0')`,
        etiqueta: `'S' || EXTRACT(WEEK FROM p.fecha)::int::text`,
      };
    case "trimestre":
      return {
        sel: `EXTRACT(YEAR FROM p.fecha)::int || '-T' || EXTRACT(QUARTER FROM p.fecha)::int`,
        etiqueta: `'T' || EXTRACT(QUARTER FROM p.fecha)::int || ' ' || to_char(p.fecha, 'YY')`,
      };
    case "semestre":
      return {
        sel: `EXTRACT(YEAR FROM p.fecha)::int || '-S' ||
              (CASE WHEN EXTRACT(MONTH FROM p.fecha) <= 6 THEN 1 ELSE 2 END)`,
        etiqueta: `'S' || (CASE WHEN EXTRACT(MONTH FROM p.fecha) <= 6 THEN 1 ELSE 2 END)
                   || ' ' || to_char(p.fecha, 'YY')`,
      };
    case "fecha":
      return { sel: `to_char(p.fecha, 'YYYY-MM-DD')`, etiqueta: `to_char(p.fecha, 'DD/MM')` };
    case "mes":
    default:
      return {
        sel: `to_char(p.fecha, 'YYYY-MM')`,
        etiqueta: `initcap(to_char(p.fecha, 'TMMon')) || ' ' || to_char(p.fecha, 'YY')`,
      };
  }
}

class InyeccionReporte {
  /**
   * Valores disponibles para los slicers: años, meses, semanas y BUs con datos.
   */
  static async getFiltros() {
    const [periodos, bus, maquinas, rango] = await Promise.all([
      db.query(
        `SELECT DISTINCT
            EXTRACT(YEAR  FROM fecha)::int AS anio,
            EXTRACT(MONTH FROM fecha)::int AS mes,
            EXTRACT(WEEK  FROM fecha)::int AS semana
           FROM iny_produccion
          ORDER BY anio DESC, mes, semana`,
      ),
      db.query(
        `SELECT bu_reporte AS bu, count(*)::int AS registros
           FROM iny_produccion
          WHERE bu_reporte IS NOT NULL
          GROUP BY bu_reporte
          ORDER BY registros DESC`,
      ),
      db.query(
        `SELECT m.codigo, m.activo
           FROM iny_maquinas m
          ORDER BY m.codigo`,
      ),
      db.query(`SELECT min(fecha) AS desde, max(fecha) AS hasta FROM iny_produccion`),
    ]);

    return {
      periodos: periodos.rows,
      unidadesNegocio: bus.rows,
      maquinas: maquinas.rows,
      rango: rango.rows[0],
    };
  }

  /**
   * Serie del combo de la página Inj: producción, scrap y %Scrap por periodo y BU.
   */
  static async getSerieTemporal(filtros = {}, agrupar = "mes") {
    if (!AGRUPACIONES.includes(agrupar)) agrupar = "mes";
    const eje = ejeTemporal(agrupar);
    const f = construirFiltro(filtros);

    const { rows } = await db.query(
      `SELECT ${eje.sel} AS periodo,
              ${eje.etiqueta} AS etiqueta,
              p.bu_reporte AS bu,
              sum(p.produccion)::float AS produccion,
              sum(p.scrap)::float      AS scrap,
              CASE WHEN sum(p.produccion) > 0
                   THEN round(sum(p.scrap) / sum(p.produccion) * 100, 2)::float
                   ELSE NULL END       AS pct_scrap
         FROM iny_produccion p
         ${f.where}
        GROUP BY 1, 2, 3
        ORDER BY 1, 3`,
      f.values,
    );
    return rows;
  }

  /**
   * Tarjetas de %Scrap por BU (las 4 de la página Inj) más el total.
   */
  static async getResumenPorBu(filtros = {}) {
    const f = construirFiltro(filtros);
    const { rows } = await db.query(
      `SELECT p.bu_reporte AS bu,
              count(*)::int            AS registros,
              sum(p.produccion)::float AS produccion,
              sum(p.scrap)::float      AS scrap,
              CASE WHEN sum(p.produccion) > 0
                   THEN round(sum(p.scrap) / sum(p.produccion) * 100, 2)::float
                   ELSE NULL END       AS pct_scrap
         FROM iny_produccion p
         ${f.where}
        GROUP BY p.bu_reporte
        ORDER BY produccion DESC NULLS LAST`,
      f.values,
    );
    return rows;
  }

  /**
   * Serie de la página Inj 2: producción y %Scrap por máquina.
   * Excluye los renglones sin máquina (el rezago), igual que el Power BI.
   */
  static async getPorMaquina(filtros = {}) {
    const f = construirFiltro(filtros);
    const extra = f.where ? `${f.where} AND p.maquina_id IS NOT NULL` : `WHERE p.maquina_id IS NOT NULL`;

    const { rows } = await db.query(
      `SELECT m.codigo AS maquina,
              sum(p.produccion)::float AS produccion,
              sum(p.scrap)::float      AS scrap,
              CASE WHEN sum(p.produccion) > 0
                   THEN round(sum(p.scrap) / sum(p.produccion) * 100, 2)::float
                   ELSE NULL END       AS pct_scrap
         FROM iny_produccion p
         JOIN iny_maquinas m ON m.id = p.maquina_id
         ${extra}
        GROUP BY m.codigo
        ORDER BY produccion DESC`,
      f.values,
    );
    return rows;
  }

  /**
   * Totales del periodo, para el encabezado.
   */
  static async getTotales(filtros = {}) {
    const f = construirFiltro(filtros);
    const { rows } = await db.query(
      `SELECT count(*)::int                                   AS registros,
              count(*) FILTER (WHERE p.tipo = 'SCRAP_MODELO')::int AS registros_rezago,
              sum(p.produccion)::float                        AS produccion,
              sum(p.scrap)::float                             AS scrap,
              CASE WHEN sum(p.produccion) > 0
                   THEN round(sum(p.scrap) / sum(p.produccion) * 100, 2)::float
                   ELSE NULL END                              AS pct_scrap,
              min(p.fecha) AS desde,
              max(p.fecha) AS hasta
         FROM iny_produccion p
         ${f.where}`,
      f.values,
    );
    return rows[0];
  }

  /**
   * Compara dos periodos del mismo tipo (mes vs mes, trimestre vs trimestre...).
   *
   * Devuelve cada lado por separado y el delta por BU. El delta de producción y
   * scrap va en piezas y en %, pero el de %Scrap va en PUNTOS PORCENTUALES: es
   * una diferencia entre dos tasas, no un cambio relativo.
   *
   * No se calcula ningún delta agregado entre BU: son componentes distintos y
   * no se suman (unfin es la chancla sin correa, strap es la correa).
   *
   * @param {String} tipo  mes | trimestre | semestre | anio
   * @param {Object} a     { anio, numero }
   * @param {Object} b     { anio, numero }
   * @param {Array}  bu    unidades de negocio a incluir (opcional)
   */
  static async getComparativo(tipo, a, b, bu) {
    if (!TIPOS_PERIODO.includes(tipo)) tipo = "mes";
    const rangoA = rangoPeriodo(tipo, a.anio, a.numero);
    const rangoB = rangoPeriodo(tipo, b.anio, b.numero);

    // Hasta dónde hay datos capturados: sirve para avisar cuando un periodo
    // está a medias. Comparar 2025 completo contra un 2026 que sólo llega a
    // agosto da una caída del 35% que no es real.
    const { rows: limite } = await db.query(
      `SELECT max(fecha) AS hasta FROM iny_produccion`,
    );
    const ultimoConDatos = limite[0]?.hasta
      ? new Date(limite[0].hasta).toISOString().slice(0, 10)
      : null;

    const lado = async (rango) => {
      const filtros = { fechaInicio: rango.desde, fechaFin: rango.hasta, bu };
      const [porBu, porMaquina, totales] = await Promise.all([
        this.getResumenPorBu(filtros),
        this.getPorMaquina(filtros),
        this.getTotales(filtros),
      ]);
      const parcial = ultimoConDatos != null && rango.hasta > ultimoConDatos;
      return {
        ...rango,
        porBu,
        porMaquina,
        registros: totales.registros,
        parcial,
        // último día realmente capturado dentro del periodo
        hastaConDatos: totales.hasta
          ? new Date(totales.hasta).toISOString().slice(0, 10)
          : null,
      };
    };

    const [ladoA, ladoB] = await Promise.all([lado(rangoA), lado(rangoB)]);

    // Delta por BU: se recorren todas las que aparecen en cualquiera de los dos
    const bus = [
      ...new Set([
        ...ladoA.porBu.map((x) => x.bu),
        ...ladoB.porBu.map((x) => x.bu),
      ]),
    ].filter(Boolean);

    const variacion = (antes, despues) =>
      antes && antes !== 0 ? ((despues - antes) / antes) * 100 : null;

    const delta = bus.map((nombre) => {
      const x = ladoA.porBu.find((r) => r.bu === nombre);
      const y = ladoB.porBu.find((r) => r.bu === nombre);
      const prodA = x?.produccion ?? 0;
      const prodB = y?.produccion ?? 0;
      const scrapA = x?.scrap ?? 0;
      const scrapB = y?.scrap ?? 0;
      return {
        bu: nombre,
        produccionA: prodA,
        produccionB: prodB,
        produccionDelta: prodB - prodA,
        produccionVariacion: variacion(prodA, prodB),
        scrapA,
        scrapB,
        scrapDelta: scrapB - scrapA,
        scrapVariacion: variacion(scrapA, scrapB),
        pctScrapA: x?.pct_scrap ?? null,
        pctScrapB: y?.pct_scrap ?? null,
        // en puntos porcentuales
        pctScrapDelta:
          x?.pct_scrap != null && y?.pct_scrap != null
            ? +(y.pct_scrap - x.pct_scrap).toFixed(2)
            : null,
      };
    });

    // Ordenado por el volumen del periodo más reciente de los dos
    delta.sort((p, q) => Math.max(q.produccionA, q.produccionB) - Math.max(p.produccionA, p.produccionB));

    return { tipo, a: ladoA, b: ladoB, delta };
  }

  /**
   * Todo lo que necesita la pantalla en una sola llamada.
   */
  static async getDashboard(filtros = {}, agrupar = "mes") {
    const [totales, porBu, serie, porMaquina] = await Promise.all([
      this.getTotales(filtros),
      this.getResumenPorBu(filtros),
      this.getSerieTemporal(filtros, agrupar),
      this.getPorMaquina(filtros),
    ]);
    return { totales, porBu, serie, porMaquina, agrupar };
  }
}

module.exports = InyeccionReporte;
