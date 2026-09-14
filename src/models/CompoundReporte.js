const db = require("../config/database");

/**
 * Consultas del reporte de Compound.
 *
 * Reemplaza las dos páginas del .pbix Compound y agrega lo que el Excel ya
 * traía y nadie graficaba: el tiempo muerto ABIERTO POR CAUSA. Tres causas
 * explican el 89% del paro, y esa es la única lectura accionable del área.
 *
 * Tres correcciones deliberadas respecto al Power BI:
 *
 *   1. Lo que el .pbix llama "%SCRAP" NO es scrap. La columna del Excel se
 *      llama "Kg PERDIDOS" pero vale produccion - meta, con el signo al revés
 *      del nombre: en el histórico da +223,972 kg, o sea 5.76% POR ENCIMA de
 *      la meta. Aquí se llama `kg_vs_meta` y se lee como excedente.
 *
 *   2. Los renglones sin turno (464) tienen produccion y turno_horas en cero:
 *      son líneas paradas, no captura faltante. Entran en los conteos pero se
 *      excluyen de cualquier razón, porque el denominador sería cero.
 *
 *   3. La meta de reciclado NO es una sola: Crocs pasó de 5% en 2023 a 8%
 *      desde 2024, Suela va en 5% y Producto Técnico en 2%. Graficar una sola
 *      línea de meta escondía que Crocs lleva dos años por debajo.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Cómo se corta el eje temporal. La clave siempre lleva el año: sin él, dos
 * "Marzo" de años distintos se dibujarían como un solo punto.
 */
const AGRUPACIONES = {
  anio: { sql: "to_char(fecha, 'YYYY')", etiqueta: (c) => c },
  mes: {
    sql: "to_char(fecha, 'YYYY-MM')",
    etiqueta: (c) => `${MESES[Number(c.slice(5, 7)) - 1]} ${c.slice(0, 4)}`,
  },
  semana: {
    sql: "to_char(fecha, 'IYYY-\"S\"IW')",
    etiqueta: (c) => `Sem ${c.slice(6)} ${c.slice(0, 4)}`,
  },
  fecha: { sql: "to_char(fecha, 'YYYY-MM-DD')", etiqueta: (c) => c },
};

/** Las siete causas, con su columna. El orden es el del catálogo. */
const CAUSAS = [
  ["CC", "paro_cc"], ["PLAN", "paro_plan"], ["TMM", "paro_tmm"],
  ["AM", "paro_am"], ["FT", "paro_ft"], ["FP", "paro_fp"], ["LH", "paro_lh"],
];

const TIPOS_PERIODO = ["mes", "trimestre", "semestre", "anio"];

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Arma el WHERE compartido.
 *
 * @returns {{sql: String, params: Array}}
 */
function construirFiltros(f = {}) {
  const cond = [];
  const params = [];
  const add = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace("?", `$${params.length}`));
  };

  if (f.lineas?.length) add("linea = ANY(?)", f.lineas);
  if (f.turnos?.length) add("turno = ANY(?)", f.turnos);
  if (f.supervisores?.length) add("supervisor = ANY(?)", f.supervisores);
  if (f.fechaInicio) add("fecha >= ?::date", f.fechaInicio);
  if (f.fechaFin) add("fecha <= ?::date", f.fechaFin);
  if (f.anio) add("EXTRACT(YEAR FROM fecha) = ?", f.anio);
  if (f.mes) add("EXTRACT(MONTH FROM fecha) = ?", f.mes);
  if (f.trimestre) add("EXTRACT(QUARTER FROM fecha) = ?", f.trimestre);
  if (f.semestre) {
    params.push(f.semestre);
    cond.push(`CEIL(EXTRACT(MONTH FROM fecha) / 6.0) = $${params.length}`);
  }

  return { sql: cond.length ? cond.join("\n     AND ") : "TRUE", params };
}

/** Bloque SQL con los indicadores del área, reutilizado en varios cortes. */
const INDICADORES = `
  COUNT(*)::int                                    AS registros,
  SUM(produccion_kg)                               AS produccion_kg,
  SUM(turno_horas)                                 AS turno_horas,
  SUM(tiempo_muerto)                               AS paro_horas,
  SUM(horas_operacion)                             AS horas_operacion,
  SUM(kg_vs_meta)                                  AS kg_vs_meta,
  SUM(meta_turno_kg)                               AS meta_kg,
  -- Las razones se protegen con NULLIF: 464 renglones traen el turno en cero
  -- porque la línea estuvo parada, y dividir entre cero los volvería infinito.
  SUM(tiempo_muerto) / NULLIF(SUM(turno_horas), 0) * 100      AS pct_paro,
  SUM(produccion_kg) / NULLIF(SUM(horas_operacion), 0)        AS kg_hora,
  SUM(produccion_kg) / NULLIF(SUM(meta_turno_kg), 0) * 100    AS pct_cumplimiento`;

const CompoundReporte = {
  /** Valores disponibles para los filtros. */
  async getFiltros() {
    const [anios, lineas, supervisores, bus] = await Promise.all([
      db.query(
        `SELECT EXTRACT(YEAR FROM fecha)::int AS anio, COUNT(*)::int AS registros
           FROM comp_produccion GROUP BY 1 ORDER BY 1 DESC`,
      ),
      db.query(
        `SELECT linea, COUNT(*)::int AS registros
           FROM comp_produccion GROUP BY 1 ORDER BY 1`,
      ),
      db.query(
        `SELECT supervisor, COUNT(*)::int AS registros
           FROM comp_produccion WHERE supervisor IS NOT NULL
          GROUP BY 1 ORDER BY 2 DESC`,
      ),
      db.query(
        `SELECT bu, COUNT(*)::int AS registros
           FROM comp_recuperacion GROUP BY 1 ORDER BY 1`,
      ),
    ]);

    return {
      anios: anios.rows,
      lineas: lineas.rows,
      supervisores: supervisores.rows,
      bus: bus.rows,
      turnos: [{ turno: "A" }, { turno: "B" }],
      meses: MESES.map((nombre, i) => ({ numero: i + 1, nombre })),
    };
  },

  /**
   * Todo el tablero de producción en una llamada.
   *
   * @param {Object} filtros
   * @param {String} agrupar  anio | mes | semana | fecha
   */
  async getDashboard(filtros = {}, agrupar = "mes") {
    const g = AGRUPACIONES[agrupar] || AGRUPACIONES.mes;
    const { sql: where, params } = construirFiltros(filtros);

    // Suma de cada causa, para el Pareto y para el apilado por periodo
    const sumasCausa = CAUSAS.map(([cod, col]) => `SUM(${col}) AS "${cod}"`).join(",\n           ");

    const [resumen, serie, causas, causasPeriodo, porLinea, porTurno, porSupervisor, calidad, catalogo] =
      await Promise.all([
        db.query(
          `SELECT ${INDICADORES},
                  MIN(fecha) AS desde, MAX(fecha) AS hasta,
                  AVG(meta_kg_hora) AS meta_kg_hora,
                  COUNT(*) FILTER (WHERE meta_turno_kg > 0
                                     AND produccion_kg < meta_turno_kg)::int AS turnos_bajo_meta,
                  COUNT(*) FILTER (WHERE meta_turno_kg > 0)::int AS turnos_con_meta
             FROM comp_produccion WHERE ${where}`,
          params,
        ),
        db.query(
          `SELECT ${g.sql} AS clave, ${INDICADORES}
             FROM comp_produccion WHERE ${where}
            GROUP BY clave ORDER BY clave`,
          params,
        ),
        db.query(
          `SELECT ${sumasCausa} FROM comp_produccion WHERE ${where}`,
          params,
        ),
        db.query(
          `SELECT ${g.sql} AS clave, ${sumasCausa},
                  SUM(turno_horas) AS turno_horas
             FROM comp_produccion WHERE ${where}
            GROUP BY clave ORDER BY clave`,
          params,
        ),
        db.query(
          `SELECT linea, ${INDICADORES}
             FROM comp_produccion WHERE ${where}
            GROUP BY linea ORDER BY linea`,
          params,
        ),
        db.query(
          `SELECT turno, ${INDICADORES}
             FROM comp_produccion WHERE ${where} AND turno IS NOT NULL
            GROUP BY turno ORDER BY turno`,
          params,
        ),
        db.query(
          `SELECT supervisor, ${INDICADORES}
             FROM comp_produccion
            WHERE ${where} AND supervisor IS NOT NULL AND turno_horas > 0
            GROUP BY supervisor ORDER BY SUM(produccion_kg) DESC`,
          params,
        ),
        // Salud de la captura: se muestra en pantalla en vez de esconderse
        db.query(
          `SELECT COUNT(*) FILTER (WHERE horas_operacion < 0)::int      AS paro_mayor_que_turno,
                  COUNT(*) FILTER (WHERE turno IS NULL)::int            AS sin_turno,
                  COUNT(*) FILTER (WHERE meta_turno_kg IS NULL
                                      OR meta_turno_kg = 0)::int        AS sin_meta,
                  COUNT(*) FILTER (WHERE produccion_kg = 0)::int        AS produccion_cero,
                  COUNT(*)::int                                         AS total
             FROM comp_produccion WHERE ${where}`,
          params,
        ),
        db.query(
          "SELECT codigo, nombre, planeado, confirmada, orden FROM comp_causas_paro ORDER BY orden",
        ),
      ]);

    const r = resumen.rows[0] || {};
    const cat = new Map(catalogo.rows.map((c) => [c.codigo, c]));

    // ------------------------------------------------- Pareto de causas
    const fila = causas.rows[0] || {};
    const totalParo = CAUSAS.reduce((a, [cod]) => a + Number(fila[cod] || 0), 0);
    let acumulado = 0;
    const paretoParo = CAUSAS.map(([cod]) => ({
      codigo: cod,
      horas: Number(fila[cod] || 0),
      ...cat.get(cod),
    }))
      .sort((a, b) => b.horas - a.horas)
      .map((c) => {
        acumulado += c.horas;
        return {
          ...c,
          pct: totalParo ? (c.horas / totalParo) * 100 : 0,
          pctAcumulado: totalParo ? (acumulado / totalParo) * 100 : 0,
        };
      });

    // ------------------------------- Causas por periodo, para el apilado
    const causasSerie = causasPeriodo.rows.map((f) => {
      const punto = {
        clave: f.clave,
        etiqueta: g.etiqueta(f.clave),
        turnoHoras: num(f.turno_horas),
      };
      for (const [cod] of CAUSAS) punto[cod] = Number(f[cod] || 0);
      return punto;
    });

    const mapear = (f) => ({
      registros: f.registros,
      produccionKg: num(f.produccion_kg),
      turnoHoras: num(f.turno_horas),
      paroHoras: num(f.paro_horas),
      horasOperacion: num(f.horas_operacion),
      kgVsMeta: num(f.kg_vs_meta),
      metaKg: num(f.meta_kg),
      pctParo: num(f.pct_paro),
      kgHora: num(f.kg_hora),
      pctCumplimiento: num(f.pct_cumplimiento),
    });

    return {
      agrupacion: agrupar,
      resumen: {
        ...mapear(r),
        desde: r.desde, hasta: r.hasta,
        metaKgHora: num(r.meta_kg_hora),
        turnosBajoMeta: r.turnos_bajo_meta,
        turnosConMeta: r.turnos_con_meta,
        // Excedente sobre la meta, en porcentaje. Positivo = se produjo de más.
        pctVsMeta: r.meta_kg ? (Number(r.kg_vs_meta) / Number(r.meta_kg)) * 100 : null,
      },
      serie: serie.rows.map((f) => ({
        clave: f.clave, etiqueta: g.etiqueta(f.clave), ...mapear(f),
      })),
      paretoParo,
      causasSerie,
      causas: catalogo.rows,
      porLinea: porLinea.rows.map((f) => ({ linea: f.linea, ...mapear(f) })),
      porTurno: porTurno.rows.map((f) => ({ turno: f.turno, ...mapear(f) })),
      porSupervisor: porSupervisor.rows.map((f) => ({
        supervisor: f.supervisor, ...mapear(f),
      })),
      calidadCaptura: calidad.rows[0],
    };
  },

  /**
   * Recuperación de polvo, por periodo y BU.
   *
   * La meta se saca del propio dato (`MAX(meta)` del periodo) porque cambió con
   * el tiempo y es distinta por BU: Crocs 5% en 2023 y 8% desde 2024, Suela 5%,
   * Producto Técnico 2%.
   */
  async getRecuperacion(filtros = {}, agrupar = "anio") {
    const g = AGRUPACIONES[agrupar] || AGRUPACIONES.anio;
    const cond = [];
    const params = [];
    const add = (sql, valor) => {
      params.push(valor);
      cond.push(sql.replace("?", `$${params.length}`));
    };
    if (filtros.bus?.length) add("bu = ANY(?)", filtros.bus);
    if (filtros.anio) add("EXTRACT(YEAR FROM fecha) = ?", filtros.anio);
    if (filtros.fechaInicio) add("fecha >= ?::date", filtros.fechaInicio);
    if (filtros.fechaFin) add("fecha <= ?::date", filtros.fechaFin);
    const where = cond.length ? cond.join(" AND ") : "TRUE";

    const medidas = `
      SUM(produccion_kg)                                            AS produccion_kg,
      SUM(consumo_polvo_kg)                                         AS polvo_kg,
      SUM(purga_kg)                                                 AS purga_kg,
      SUM(consumo_polvo_kg) / NULLIF(SUM(produccion_kg), 0) * 100   AS pct_reciclado,
      SUM(purga_kg)         / NULLIF(SUM(produccion_kg), 0) * 100   AS pct_purga,
      MAX(meta) * 100                                               AS meta_pct`;

    const [total, porBu, serie] = await Promise.all([
      db.query(
        `SELECT ${medidas}, MIN(fecha) AS desde, MAX(fecha) AS hasta
           FROM comp_recuperacion WHERE ${where}`,
        params,
      ),
      db.query(
        `SELECT bu, ${medidas} FROM comp_recuperacion WHERE ${where}
          GROUP BY bu ORDER BY SUM(produccion_kg) DESC`,
        params,
      ),
      db.query(
        `SELECT ${g.sql} AS clave, bu, ${medidas}
           FROM comp_recuperacion WHERE ${where}
          GROUP BY clave, bu ORDER BY clave, bu`,
        params,
      ),
    ]);

    const mapear = (f) => ({
      produccionKg: num(f.produccion_kg),
      polvoKg: num(f.polvo_kg),
      purgaKg: num(f.purga_kg),
      pctReciclado: num(f.pct_reciclado),
      pctPurga: num(f.pct_purga),
      metaPct: num(f.meta_pct),
    });

    return {
      agrupacion: agrupar,
      resumen: { ...mapear(total.rows[0] || {}), desde: total.rows[0]?.desde, hasta: total.rows[0]?.hasta },
      porBu: porBu.rows.map((f) => ({ bu: f.bu, ...mapear(f) })),
      serie: serie.rows.map((f) => ({
        clave: f.clave, etiqueta: g.etiqueta(f.clave), bu: f.bu, ...mapear(f),
      })),
    };
  },

  /** Compara dos periodos del mismo tipo, igual que Inyección y Moldes. */
  async getComparativo(tipo, a, b, filtros = {}) {
    const t = TIPOS_PERIODO.includes(tipo) ? tipo : "mes";

    const armar = (p) => {
      const base = { ...filtros, anio: p.anio };
      if (t === "mes") base.mes = p.numero;
      if (t === "trimestre") base.trimestre = p.numero;
      if (t === "semestre") base.semestre = p.numero;
      return base;
    };
    const etiqueta = (p) => {
      if (t === "mes") return `${MESES[p.numero - 1]} ${p.anio}`;
      if (t === "trimestre") return `T${p.numero} ${p.anio}`;
      if (t === "semestre") return `S${p.numero} ${p.anio}`;
      return String(p.anio);
    };

    const [da, dbb, ultimo] = await Promise.all([
      this.getDashboard(armar(a), "mes"),
      this.getDashboard(armar(b), "mes"),
      db.query("SELECT to_char(MAX(fecha), 'YYYY-MM-DD') AS hasta FROM comp_produccion"),
    ]);

    const variacion = (x, y) =>
      x === null || y === null || !x ? null : ((y - x) / x) * 100;

    // Un periodo que aún no termina no se compara de igual a igual
    const hastaConDatos = ultimo.rows[0]?.hasta || null;
    const marcar = (p) => {
      const dd = (v) => String(v).padStart(2, "0");
      const mesInicio =
        t === "trimestre" ? (p.numero - 1) * 3 + 1
        : t === "semestre" ? (p.numero - 1) * 6 + 1
        : t === "anio" ? 1 : p.numero;
      const dura = t === "trimestre" ? 3 : t === "semestre" ? 6 : t === "anio" ? 12 : 1;
      const ultimoDia = new Date(Date.UTC(p.anio, mesInicio + dura - 1, 0)).getUTCDate();
      const hasta = `${p.anio}-${dd(mesInicio + dura - 1)}-${dd(ultimoDia)}`;
      return { hasta, parcial: Boolean(hastaConDatos && hastaConDatos < hasta), hastaConDatos };
    };

    // Delta por causa de paro: es donde se ve si la mejora fue real
    const porCodigo = new Map(da.paretoParo.map((c) => [c.codigo, c]));
    const delta = dbb.paretoParo.map((cb) => {
      const ca = porCodigo.get(cb.codigo);
      return {
        codigo: cb.codigo,
        nombre: cb.nombre,
        confirmada: cb.confirmada,
        horasA: ca?.horas ?? 0,
        horasB: cb.horas,
        variacion: variacion(ca?.horas ?? 0, cb.horas),
      };
    });

    return {
      tipo: t,
      a: { etiqueta: etiqueta(a), ...da.resumen, ...marcar(a) },
      b: { etiqueta: etiqueta(b), ...dbb.resumen, ...marcar(b) },
      delta,
      variacion: {
        produccion: variacion(da.resumen.produccionKg, dbb.resumen.produccionKg),
        pctParo: variacion(da.resumen.pctParo, dbb.resumen.pctParo),
        kgHora: variacion(da.resumen.kgHora, dbb.resumen.kgHora),
        pctCumplimiento: variacion(da.resumen.pctCumplimiento, dbb.resumen.pctCumplimiento),
      },
    };
  },
};

module.exports = CompoundReporte;
