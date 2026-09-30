const db = require("../config/database");

/**
 * Consultas del reporte de Customer Service.
 *
 * Dos mitades que no se parecen en nada:
 *
 *   KPI       OTS, SC y OTIF. Una serie semanal por año y unidad de negocio,
 *             contra una meta fija. Es un tablero de seguimiento.
 *   MUESTRAS  El detalle de cada muestra solicitada, con cuánto tardó y cuánto
 *             debía tardar. Es un análisis de cumplimiento.
 *
 * ---------------------------------------------------------------------------
 * EL % DE CUMPLIMIENTO SE CALCULA AQUÍ, NO SE LEE DEL LIBRO
 * ---------------------------------------------------------------------------
 * En 'Muestras' el libro trae las dos fórmulas cruzadas: la celda rotulada
 * "en tiempo" apunta al conteo de los RETRASADOS (114/177 = 64.4%) y la
 * rotulada "con retraso" apunta al de los que SÍ llegaron a tiempo
 * (58/177 = 32.8%). El reporte calcula cada una desde el detalle y las pone
 * bajo el rótulo que les toca.
 *
 * ---------------------------------------------------------------------------
 * DOS FORMAS DE MEDIR EL CUMPLIMIENTO, Y NO DAN LO MISMO
 * ---------------------------------------------------------------------------
 *   Por muestra  58 de 177 llegaron a tiempo          32.8%
 *   Por par      562 de 1,128 pares llegaron a tiempo 49.8%
 *
 * La diferencia es real: las solicitudes grandes cumplen mejor que las chicas.
 * Se muestran las dos y la principal es la de muestras, que es la que usa el
 * libro y la que responde "¿de cada diez solicitudes, cuántas entregamos a
 * tiempo?".
 *
 * ---------------------------------------------------------------------------
 * SEMANA CAPTURADA: SE PREGUNTA POR LAS UNIDADES, NO POR EL GENERAL
 * ---------------------------------------------------------------------------
 * El libro trae las 53 semanas del año precargadas, y en las que todavía no
 * han llegado la columna del indicador general vale CERO, no vacío. Promediar
 * eso hunde el año en curso: OTIF 2026 sale en 67% contando las 15 semanas de
 * octubre a diciembre como ceros, y en 94% contando solo lo capturado.
 *
 * Así que una semana cuenta cuando alguna unidad de negocio tiene valor. Se
 * verificó sobre los cuatro años que la equivalencia es exacta: no hay una sola
 * semana con el general en cero y alguna unidad con valor, ni al revés.
 *
 * Lo que SÍ es real es un cero de UNIDAD: en la semana 34 de 2026 Suela salió
 * en 0% y el general en 81.2%. Por eso el filtro pregunta por la existencia del
 * dato de unidad y no por que el general sea mayor que cero.
 *
 * ---------------------------------------------------------------------------
 * EL ESTADO ES CONFIABLE
 * ---------------------------------------------------------------------------
 * Se verificó contra los días: de los 58 'Finalizado en tiempo', los 58 tienen
 * dias_proceso <= dias_objetivo; de los 114 'con retraso', 112 lo exceden y 2
 * no traen días. O sea que el estado del libro no está puesto a mano ni quedó
 * viejo, así que se usa tal cual en vez de recalcularlo.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Los tres indicadores, con su nombre largo y lo que significan. */
const INDICADORES = {
  OTS: {
    nombre: "OTS",
    largo: "On Time Shipment",
    descripcion: "Embarques que salieron en la fecha comprometida",
  },
  OTIF: {
    nombre: "OTIF",
    largo: "On Time In Full",
    descripcion: "Embarques que salieron a tiempo Y completos",
  },
  SC: {
    nombre: "SC",
    largo: "Service Level",
    descripcion: "Nivel de servicio al cliente",
  },
};

/**
 * Los estados que cuentan como cumplimiento.
 *
 * 'Retrasado' es el que sigue abierto y ya se pasó: no es un incumplimiento
 * consumado pero tampoco un cumplimiento, y se reporta aparte.
 */
const EN_TIEMPO = "Finalizado en tiempo";
const CON_RETRASO = "Finalizado con retraso";
const ABIERTO = "Retrasado";

// =============================================
// KPI
// =============================================

/** WHERE del KPI. */
function filtrosKpi(f = {}) {
  const cond = [];
  const params = [];
  const add = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace("?", `$${params.length}`));
  };

  if (f.indicador) add("indicador = ?", f.indicador);
  if (f.indicadores?.length) add("indicador = ANY(?)", f.indicadores);
  if (f.anio) add("anio = ?", Number(f.anio));
  if (f.anios?.length) add("anio = ANY(?)", f.anios.map(Number));
  if (f.bus?.length) add("bu = ANY(?)", f.bus);

  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

/**
 * Tarjetas del año: dónde va cada indicador.
 *
 * La "última semana" es la última CON valor, no la última del calendario: el
 * libro trae las 53 semanas precargadas y las que no han llegado están vacías.
 */
async function kpiResumen({ anio } = {}) {
  const { rows } = await db.query(
    `WITH base AS (
       SELECT indicador, anio, semana, MAX(meta) AS meta,
              -- El valor general se repite en las tres unidades de la semana
              MAX(valor_general) AS valor
         FROM cs_kpi
        WHERE anio = $1
        GROUP BY indicador, anio, semana
        -- Ver SEMANA CAPTURADA en el encabezado
       HAVING COUNT(valor_bu) > 0
     ),
     ultima AS (
       SELECT DISTINCT ON (indicador) indicador, semana, valor
         FROM base ORDER BY indicador, semana DESC
     )
     SELECT b.indicador,
            MAX(b.meta)                                       AS meta,
            COUNT(*)                                          AS semanas,
            COUNT(*) FILTER (WHERE b.valor >= b.meta)         AS semanas_en_meta,
            AVG(b.valor)                                      AS promedio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY b.valor) AS mediana,
            MIN(b.valor)                                      AS peor,
            MAX(b.valor)                                      AS mejor,
            u.semana                                          AS ultima_semana,
            u.valor                                           AS ultimo_valor
       FROM base b JOIN ultima u ON u.indicador = b.indicador
      GROUP BY b.indicador, u.semana, u.valor`,
    [Number(anio)],
  );

  return rows.map((r) => ({
    ...INDICADORES[r.indicador],
    indicador: r.indicador,
    meta: num(r.meta),
    semanas: Number(r.semanas),
    semanasEnMeta: Number(r.semanas_en_meta),
    promedio: num(r.promedio),
    mediana: num(r.mediana),
    peor: num(r.peor),
    mejor: num(r.mejor),
    ultimaSemana: Number(r.ultima_semana),
    ultimoValor: num(r.ultimo_valor),
  }));
}

/**
 * Serie semanal de un indicador: el general y el de cada unidad.
 *
 * Se pivotea a una fila por semana con una columna por unidad, que es lo que
 * necesita la gráfica de líneas.
 */
async function kpiSerie({ indicador, anio, bus } = {}) {
  const { where, params } = filtrosKpi({ indicador, anio, bus });
  const { rows } = await db.query(
    `SELECT anio, semana, bu, mes, trimestre, fecha,
            meta, valor_general, valor_bu, ponderacion
       FROM cs_kpi ${where}
      ORDER BY anio, semana, bu`,
    params,
  );

  const porSemana = new Map();
  const unidades = new Set();

  for (const r of rows) {
    const clave = `${r.anio}-${String(r.semana).padStart(2, "0")}`;
    if (!porSemana.has(clave)) {
      porSemana.set(clave, {
        clave,
        anio: r.anio,
        semana: r.semana,
        etiqueta: `S${r.semana}`,
        mes: r.mes,
        trimestre: r.trimestre,
        fecha: r.fecha,
        meta: num(r.meta),
        general: num(r.valor_general),
        bus: {},
      });
    }
    if (r.valor_bu !== null) {
      porSemana.get(clave).bus[r.bu] = num(r.valor_bu);
      unidades.add(r.bu);
    }
  }

  // Las semanas sin captura se quitan. Es lo que evita que la línea se
  // desplome a cero en las semanas del año que todavía no han llegado, porque
  // el libro las trae precargadas con el general en 0.
  const semanas = [...porSemana.values()].filter(
    (s) => Object.keys(s.bus).length > 0,
  );

  return { indicador, semanas, unidades: [...unidades].sort() };
}

/** Promedio por año e indicador, para comparar ejercicios completos. */
async function kpiAnual({ bus } = {}) {
  const { where, params } = filtrosKpi({ bus });
  const { rows } = await db.query(
    `WITH base AS (
       SELECT indicador, anio, semana, MAX(meta) AS meta, MAX(valor_general) AS valor
         FROM cs_kpi ${where}
        GROUP BY indicador, anio, semana
       HAVING COUNT(valor_bu) > 0
     )
     SELECT indicador, anio, MAX(meta) AS meta, COUNT(*) AS semanas,
            AVG(valor) AS promedio,
            COUNT(*) FILTER (WHERE valor >= meta) AS semanas_en_meta
       FROM base GROUP BY indicador, anio ORDER BY indicador, anio`,
    params,
  );
  return rows.map((r) => ({
    indicador: r.indicador,
    anio: Number(r.anio),
    meta: num(r.meta),
    semanas: Number(r.semanas),
    semanasEnMeta: Number(r.semanas_en_meta),
    promedio: num(r.promedio),
  }));
}

/**
 * Desempeño y peso de cada unidad de negocio.
 *
 * La ponderación importa para leer el indicador general: Crocs pesa cerca del
 * 78%, así que el número de la semana es prácticamente el de Crocs. Una unidad
 * chica puede estar muy mal sin que el general se mueva.
 */
async function kpiPorUnidad({ indicador, anio } = {}) {
  const { where, params } = filtrosKpi({ indicador, anio });
  const { rows } = await db.query(
    `SELECT bu,
            COUNT(valor_bu)                          AS semanas,
            AVG(valor_bu)                            AS promedio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY valor_bu) AS mediana,
            MIN(valor_bu)                            AS peor,
            MAX(valor_bu)                            AS mejor,
            AVG(ponderacion)                         AS peso,
            MAX(meta)                                AS meta,
            COUNT(*) FILTER (WHERE valor_bu >= meta) AS semanas_en_meta
       FROM cs_kpi ${where}
      GROUP BY bu ORDER BY AVG(ponderacion) DESC NULLS LAST`,
    params,
  );
  return rows.map((r) => ({
    bu: r.bu,
    semanas: Number(r.semanas),
    promedio: num(r.promedio),
    mediana: num(r.mediana),
    peor: num(r.peor),
    mejor: num(r.mejor),
    peso: num(r.peso),
    meta: num(r.meta),
    semanasEnMeta: Number(r.semanas_en_meta),
  }));
}

// =============================================
// MUESTRAS
// =============================================

/** WHERE de las muestras. */
function filtrosMuestras(f = {}) {
  const cond = [];
  const params = [];
  const add = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace("?", `$${params.length}`));
  };

  if (f.periodos?.length) add("periodo = ANY(?)", f.periodos);
  if (f.bus?.length) add("bu = ANY(?)", f.bus);
  if (f.familias?.length) add("familia = ANY(?)", f.familias);
  if (f.tipos?.length) add("tipo = ANY(?)", f.tipos);
  if (f.areas?.length) add("area = ANY(?)", f.areas);
  if (f.clientes?.length) add("cliente = ANY(?)", f.clientes);
  if (f.estados?.length) add("estado = ANY(?)", f.estados);
  if (f.fechaInicio) add("inicio >= ?::date", f.fechaInicio);
  if (f.fechaFin) add("inicio <= ?::date", f.fechaFin);

  return { where: cond.length ? `WHERE ${cond.join(" AND ")}` : "", params };
}

/** El bloque de conteos que se repite en casi todas las consultas. */
const CONTEOS = `
  COUNT(*)                                                   AS muestras,
  COUNT(*) FILTER (WHERE estado = '${EN_TIEMPO}')            AS en_tiempo,
  COUNT(*) FILTER (WHERE estado = '${CON_RETRASO}')          AS con_retraso,
  COUNT(*) FILTER (WHERE estado = '${ABIERTO}')              AS abiertas,
  COALESCE(SUM(pares), 0)                                    AS pares,
  COALESCE(SUM(en_tiempo), 0)                                AS pares_en_tiempo,
  COALESCE(SUM(con_retraso), 0)                              AS pares_con_retraso`;

/** Da forma a los conteos y saca los porcentajes. */
function armarConteos(r) {
  const muestras = Number(r.muestras);
  const enTiempo = Number(r.en_tiempo);
  const pares = num(r.pares) || 0;
  const paresEnTiempo = num(r.pares_en_tiempo) || 0;
  return {
    muestras,
    enTiempo,
    conRetraso: Number(r.con_retraso),
    abiertas: Number(r.abiertas),
    pares,
    paresEnTiempo,
    paresConRetraso: num(r.pares_con_retraso) || 0,
    // Los dos cumplimientos. Ver el encabezado del archivo.
    cumplimiento: muestras ? enTiempo / muestras : null,
    cumplimientoPares: pares ? paresEnTiempo / pares : null,
  };
}

/** Tarjetas de muestras. */
async function muestrasResumen(f = {}) {
  const { where, params } = filtrosMuestras(f);
  const { rows } = await db.query(
    `SELECT ${CONTEOS},
            AVG(dias_proceso)                                        AS dias_promedio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_proceso) AS dias_mediana,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY dias_proceso) AS dias_p90,
            MAX(dias_proceso)                                        AS dias_max,
            AVG(dias_objetivo)                                       AS objetivo_promedio,
            AVG(dias_proceso - dias_objetivo)                        AS desvio_promedio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_proceso - dias_objetivo) AS desvio_mediana,
            COUNT(DISTINCT cliente)                                  AS clientes,
            MIN(inicio)                                              AS desde,
            MAX(inicio)                                              AS hasta,
            COUNT(*) FILTER (WHERE dias_proceso IS NULL OR dias_objetivo IS NULL) AS sin_dias
       FROM cs_muestras ${where}`,
    params,
  );
  const r = rows[0];
  return {
    ...armarConteos(r),
    diasPromedio: num(r.dias_promedio),
    diasMediana: num(r.dias_mediana),
    diasP90: num(r.dias_p90),
    diasMax: num(r.dias_max),
    objetivoPromedio: num(r.objetivo_promedio),
    desvioPromedio: num(r.desvio_promedio),
    desvioMediana: num(r.desvio_mediana),
    clientes: Number(r.clientes),
    desde: r.desde,
    hasta: r.hasta,
    sinDias: Number(r.sin_dias),
  };
}

/** Por dónde se puede cortar el análisis de muestras. */
const CORTES = {
  familia: { sql: "familia", etiqueta: "Familia" },
  tipo: { sql: "tipo", etiqueta: "Tipo" },
  bu: { sql: "bu", etiqueta: "Unidad de negocio" },
  area: { sql: "area", etiqueta: "Área solicitante" },
  cliente: { sql: "cliente", etiqueta: "Cliente" },
  periodo: { sql: "periodo", etiqueta: "Periodo" },
  estado: { sql: "estado", etiqueta: "Estado" },
};

/**
 * Muestras agrupadas por el corte que se pida.
 *
 * Un solo método en vez de siete casi iguales: el reporte enseña el mismo
 * análisis cambiando el eje, y tener una consulta sola evita que se vayan
 * separando con el tiempo.
 */
async function muestrasPorCorte(f = {}, corte = "familia", limite = null) {
  const c = CORTES[corte];
  if (!c) throw new Error(`Corte no válido: "${corte}"`);

  const { where, params } = filtrosMuestras(f);
  const { rows } = await db.query(
    `SELECT COALESCE(${c.sql}, 'Sin dato') AS grupo, ${CONTEOS},
            AVG(dias_proceso)  AS dias_promedio,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_proceso) AS dias_mediana,
            AVG(dias_objetivo) AS objetivo_promedio
       FROM cs_muestras ${where}
      GROUP BY 1 ORDER BY COUNT(*) DESC${limite ? ` LIMIT ${Number(limite)}` : ""}`,
    params,
  );
  return {
    corte,
    etiqueta: c.etiqueta,
    grupos: rows.map((r) => ({
      grupo: r.grupo,
      ...armarConteos(r),
      diasPromedio: num(r.dias_promedio),
      diasMediana: num(r.dias_mediana),
      objetivoPromedio: num(r.objetivo_promedio),
    })),
  };
}

/** Evolución mensual, por fecha de inicio de la muestra. */
async function muestrasMensual(f = {}) {
  const { where, params } = filtrosMuestras(f);
  const { rows } = await db.query(
    `SELECT to_char(inicio, 'YYYY-MM') AS clave, ${CONTEOS},
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_proceso) AS dias_mediana
       FROM cs_muestras ${where}${where ? " AND" : " WHERE"} inicio IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    params,
  );
  return rows.map((r) => ({
    clave: r.clave,
    etiqueta: `${MESES[Number(r.clave.slice(5, 7)) - 1].slice(0, 3)} ${r.clave.slice(2, 4)}`,
    ...armarConteos(r),
    diasMediana: num(r.dias_mediana),
  }));
}

/**
 * Cuánto se tardó de más, por rangos.
 *
 * Es la pregunta que no contesta el % de cumplimiento: una cosa es entregar
 * tarde por un día y otra por un mes, y en el % pesan igual.
 */
async function muestrasDesvio(f = {}) {
  const { where, params } = filtrosMuestras(f);
  const { rows } = await db.query(
    `WITH d AS (
       SELECT dias_proceso - dias_objetivo AS desvio
         FROM cs_muestras ${where}${where ? " AND" : " WHERE"}
              dias_proceso IS NOT NULL AND dias_objetivo IS NOT NULL
     )
     SELECT CASE
              WHEN desvio <= -5 THEN '5 o más días antes'
              WHEN desvio <   0 THEN 'Hasta 4 días antes'
              WHEN desvio =   0 THEN 'Justo en la fecha'
              WHEN desvio <=  5 THEN 'Hasta 5 días tarde'
              WHEN desvio <= 15 THEN 'De 6 a 15 días tarde'
              WHEN desvio <= 30 THEN 'De 16 a 30 días tarde'
              ELSE 'Más de 30 días tarde'
            END AS rango,
            MIN(desvio) AS orden, COUNT(*) AS muestras
       FROM d GROUP BY 1 ORDER BY 2`,
    params,
  );
  const total = rows.reduce((s, r) => s + Number(r.muestras), 0);
  return rows.map((r) => ({
    rango: r.rango,
    muestras: Number(r.muestras),
    porcentaje: total ? Number(r.muestras) / total : null,
    tarde: Number(r.orden) > 0,
  }));
}

/**
 * Días de proceso contra días objetivo, muestra por muestra.
 *
 * Alimenta la dispersión: cada punto es una solicitud y la diagonal es la meta.
 * Todo lo que quede arriba de la línea llegó tarde.
 */
async function muestrasDispersion(f = {}) {
  const { where, params } = filtrosMuestras(f);
  const { rows } = await db.query(
    `SELECT id, cliente, familia, tipo, bu, periodo, estado, muestra_id,
            dias_objetivo, dias_proceso, pares, inicio
       FROM cs_muestras ${where}${where ? " AND" : " WHERE"}
            dias_proceso IS NOT NULL AND dias_objetivo IS NOT NULL
      ORDER BY dias_proceso DESC`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    cliente: r.cliente,
    familia: r.familia,
    tipo: r.tipo,
    bu: r.bu,
    periodo: r.periodo,
    estado: r.estado,
    muestraId: r.muestra_id,
    objetivo: num(r.dias_objetivo),
    proceso: num(r.dias_proceso),
    pares: num(r.pares),
    inicio: r.inicio,
  }));
}

/** El detalle, para la tabla y la exportación. */
async function muestrasDetalle(f = {}, { limite = 500, pagina = 1 } = {}) {
  const { where, params } = filtrosMuestras(f);
  const off = (Math.max(1, Number(pagina)) - 1) * Number(limite);

  const [datos, total] = await Promise.all([
    db.query(
      `SELECT id, area, periodo, bu, tipo, familia, cliente, muestra_id,
              inicio, fin, dias_proceso, dias_objetivo,
              dias_proceso - dias_objetivo AS desvio,
              sku, descripcion, cantidad, pares, en_tiempo, con_retraso,
              estado, entrega, comentarios
         FROM cs_muestras ${where}
        ORDER BY inicio DESC NULLS LAST, id DESC
        LIMIT ${Number(limite)} OFFSET ${off}`,
      params,
    ),
    db.query(`SELECT COUNT(*) AS n FROM cs_muestras ${where}`, params),
  ]);

  return {
    filas: datos.rows.map((r) => ({
      id: Number(r.id),
      area: r.area,
      periodo: r.periodo,
      bu: r.bu,
      tipo: r.tipo,
      familia: r.familia,
      cliente: r.cliente,
      muestraId: r.muestra_id,
      inicio: r.inicio,
      fin: r.fin,
      diasProceso: num(r.dias_proceso),
      diasObjetivo: num(r.dias_objetivo),
      desvio: num(r.desvio),
      sku: r.sku,
      descripcion: r.descripcion,
      cantidad: num(r.cantidad),
      pares: num(r.pares),
      paresEnTiempo: num(r.en_tiempo),
      paresConRetraso: num(r.con_retraso),
      estado: r.estado,
      entrega: r.entrega,
      comentarios: r.comentarios,
    })),
    total: Number(total.rows[0].n),
    pagina: Number(pagina),
    limite: Number(limite),
  };
}

// =============================================
// FILTROS
// =============================================

/** Todo lo que el reporte necesita para armar sus selectores. */
async function filtros() {
  const [kpi, muestras] = await Promise.all([
    db.query(
      `SELECT DISTINCT indicador, anio, bu FROM cs_kpi ORDER BY indicador, anio DESC, bu`,
    ),
    db.query(
      `SELECT
         array_agg(DISTINCT periodo) FILTER (WHERE periodo IS NOT NULL) AS periodos,
         array_agg(DISTINCT bu)      FILTER (WHERE bu      IS NOT NULL) AS bus,
         array_agg(DISTINCT familia) FILTER (WHERE familia IS NOT NULL) AS familias,
         array_agg(DISTINCT tipo)    FILTER (WHERE tipo    IS NOT NULL) AS tipos,
         array_agg(DISTINCT area)    FILTER (WHERE area    IS NOT NULL) AS areas,
         array_agg(DISTINCT estado)  FILTER (WHERE estado  IS NOT NULL) AS estados,
         MIN(inicio) AS desde, MAX(inicio) AS hasta, COUNT(*) AS total
       FROM cs_muestras`,
    ),
  ]);

  const anios = [...new Set(kpi.rows.map((r) => Number(r.anio)))].sort((a, b) => b - a);
  const indicadores = [...new Set(kpi.rows.map((r) => r.indicador))]
    .sort((a, b) => ["OTS", "OTIF", "SC"].indexOf(a) - ["OTS", "OTIF", "SC"].indexOf(b))
    .map((i) => ({ ...INDICADORES[i], indicador: i }));

  const m = muestras.rows[0];
  return {
    kpi: {
      anios,
      indicadores,
      bus: [...new Set(kpi.rows.map((r) => r.bu))].sort(),
      // Qué años tiene cada indicador: SC arrancó después que los otros dos
      aniosPorIndicador: indicadores.reduce((acc, i) => {
        acc[i.indicador] = kpi.rows
          .filter((r) => r.indicador === i.indicador)
          .map((r) => Number(r.anio))
          .filter((v, k, a) => a.indexOf(v) === k)
          .sort((a, b) => b - a);
        return acc;
      }, {}),
    },
    muestras: {
      periodos: (m.periodos || []).sort(),
      bus: (m.bus || []).sort(),
      familias: (m.familias || []).sort(),
      tipos: (m.tipos || []).sort(),
      areas: (m.areas || []).sort(),
      estados: (m.estados || []).sort(),
      desde: m.desde,
      hasta: m.hasta,
      total: Number(m.total),
    },
    cortes: Object.entries(CORTES).map(([id, c]) => ({ id, etiqueta: c.etiqueta })),
  };
}

module.exports = {
  kpiResumen,
  kpiSerie,
  kpiAnual,
  kpiPorUnidad,
  muestrasResumen,
  muestrasPorCorte,
  muestrasMensual,
  muestrasDesvio,
  muestrasDispersion,
  muestrasDetalle,
  filtros,
  INDICADORES,
  CORTES,
};
