const db = require("../config/database");

/**
 * Consultas del reporte de TI.
 *
 * Lee la réplica `ti_tickets`, nunca osTicket. Mide dos tiempos distintos y esa
 * es la diferencia de fondo con el reporte de Moldes:
 *
 *   RESOLUCIÓN       cerrado − creado. Es lo que tarda el área en terminar.
 *   PRIMERA RESPUESTA primera respuesta − creado. Es lo que percibe quien
 *                    levantó el ticket: cuánto tardaron en contestarle.
 *
 * Un ticket puede resolverse en tres días y sentirse bien atendido si alguien
 * contestó en veinte minutos; y resolverse en dos horas y sentirse pésimo si
 * nadie dijo nada hasta el final. Por eso van los dos.
 *
 * ---------------------------------------------------------------------------
 * LA MÉTRICA ES LA MEDIANA, NO EL PROMEDIO
 * ---------------------------------------------------------------------------
 * Igual que en Moldes, y aquí es todavía más marcado. Medido sobre los 5,463
 * tickets:
 *
 *   Otro Software   mediana 4.2 h   promedio 194.1 h   (46 veces más)
 *   Impresora       mediana 4.1 h   promedio  93.1 h
 *   MES             mediana 135 h   promedio 719.7 h
 *
 * El promedio lo dominan unos pocos tickets que quedaron abiertos meses. La
 * mediana dice lo que pasa un día normal. El promedio se sigue mostrando, en
 * gris y con advertencia, porque es la cifra a la que la gente está
 * acostumbrada.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Cómo se corta el eje temporal. La clave siempre lleva el año. */
const AGRUPACIONES = {
  anio: { sql: "to_char(creado, 'YYYY')", etiqueta: (c) => c },
  trimestre: {
    sql: "to_char(creado, 'YYYY\"-T\"Q')",
    etiqueta: (c) => `T${c.slice(6)} ${c.slice(0, 4)}`,
  },
  mes: {
    sql: "to_char(creado, 'YYYY-MM')",
    etiqueta: (c) => `${MESES[Number(c.slice(5, 7)) - 1]} ${c.slice(0, 4)}`,
  },
};

/**
 * Cuántos tickets cerrados hacen falta para que una mediana signifique algo.
 * Debajo de esto el tema se marca y no se grafica, igual que en Moldes.
 */
const MINIMO_PARA_GRAFICAR = 30;

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Arma el WHERE compartido. */
function construirFiltros(f = {}) {
  const cond = [];
  const params = [];
  const add = (sql, valor) => {
    params.push(valor);
    cond.push(sql.replace("?", `$${params.length}`));
  };

  if (f.temas?.length) add("tema_corto = ANY(?)", f.temas);
  if (f.fechaInicio) add("creado >= ?::timestamp", f.fechaInicio);
  // El fin se toma como día completo: cortar en '2026-09-20' dejaría fuera
  // todo lo levantado después de la medianoche de ese día
  if (f.fechaFin) add("creado < ?::timestamp + interval '1 day'", f.fechaFin);
  if (f.anio) add("EXTRACT(YEAR FROM creado) = ?", f.anio);

  return { sql: cond.length ? cond.join("\n     AND ") : "TRUE", params };
}

/**
 * Bloque de indicadores, reutilizado en varios cortes.
 *
 * `FILTER` en vez de CASE: es más legible y Postgres lo resuelve igual. Los
 * percentiles ignoran los NULL solos, así que un ticket abierto no cuenta para
 * la mediana de resolución pero sí para el conteo.
 */
const INDICADORES = `
  COUNT(*)::int                                                      AS tickets,
  COUNT(*) FILTER (WHERE cerrado IS NOT NULL)::int                   AS cerrados,
  COUNT(*) FILTER (WHERE estado_grupo = 'open')::int                 AS abiertos,
  COUNT(*) FILTER (WHERE reabierto IS NOT NULL)::int                 AS reabiertos,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_resolucion)      AS mediana,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_resolucion)      AS p90,
  AVG(horas_resolucion)                                              AS promedio,
  MAX(horas_resolucion)                                              AS maximo,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_primera_respuesta) AS mediana_respuesta,
  percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_primera_respuesta) AS p90_respuesta,
  COUNT(*) FILTER (WHERE primera_respuesta IS NOT NULL)::int         AS con_respuesta,
  -- Resueltos el mismo día: la medida que más se entiende sin explicar nada
  COUNT(*) FILTER (WHERE horas_resolucion <= 24)::int                AS en_24h,
  COUNT(*) FILTER (WHERE horas_primera_respuesta <= 1)::int          AS respondidos_1h`;

/** Normaliza un renglón de indicadores a números de verdad. */
const leerIndicadores = (r) => ({
  tickets: r.tickets,
  cerrados: r.cerrados,
  abiertos: r.abiertos,
  reabiertos: r.reabiertos,
  mediana: num(r.mediana),
  p90: num(r.p90),
  promedio: num(r.promedio),
  maximo: num(r.maximo),
  medianaRespuesta: num(r.mediana_respuesta),
  p90Respuesta: num(r.p90_respuesta),
  conRespuesta: r.con_respuesta,
  en24h: r.en_24h,
  respondidos1h: r.respondidos_1h,
  pctEn24h: r.cerrados ? r.en_24h / r.cerrados : null,
  pctRespondidos1h: r.con_respuesta ? r.respondidos_1h / r.con_respuesta : null,
});

const TiReporte = {
  /** Valores disponibles para los filtros. */
  async getFiltros() {
    const [temas, anios] = await Promise.all([
      db.query(
        `SELECT tema_corto AS tema, COUNT(*)::int AS tickets
           FROM ti_tickets GROUP BY 1 ORDER BY 2 DESC`,
      ),
      db.query(
        `SELECT EXTRACT(YEAR FROM creado)::int AS anio, COUNT(*)::int AS tickets
           FROM ti_tickets GROUP BY 1 ORDER BY 1 DESC`,
      ),
    ]);

    return {
      temas: temas.rows,
      anios: anios.rows,
      agrupaciones: Object.keys(AGRUPACIONES),
      minimoParaGraficar: MINIMO_PARA_GRAFICAR,
    };
  },

  /**
   * Todo el tablero en una llamada.
   *
   * @param {Object} filtros
   * @param {String} agrupar  anio | trimestre | mes
   */
  async getDashboard(filtros = {}, agrupar = "mes") {
    const grupo = AGRUPACIONES[agrupar] ? agrupar : "mes";
    const { sql: where, params } = construirFiltros(filtros);
    const ejeSql = AGRUPACIONES[grupo].sql;

    const [resumen, porTema, serie, equipo, backlog, peores] = await Promise.all([
      // ------------------------------------------------------------ Resumen
      db.query(
        `SELECT ${INDICADORES},
                to_char(MIN(creado), 'YYYY-MM-DD') AS desde,
                to_char(MAX(creado), 'YYYY-MM-DD') AS hasta
           FROM ti_tickets WHERE ${where}`,
        params,
      ),

      // ------------------------------------------------------------ Por tema
      db.query(
        `SELECT tema_corto AS tema, ${INDICADORES}
           FROM ti_tickets WHERE ${where}
          GROUP BY tema_corto ORDER BY COUNT(*) DESC`,
        params,
      ),

      // --------------------------------------------------------- Evolución
      db.query(
        `SELECT ${ejeSql} AS clave, ${INDICADORES}
           FROM ti_tickets WHERE ${where}
          GROUP BY 1 ORDER BY 1`,
        params,
      ),

      // ------------------------------------------------------------- Equipo
      //
      // SIN NOMBRES, a propósito. Se enseña cuántas personas atienden y cómo se
      // reparte el trabajo entre ellas, no quién es cada una ni quién tarda
      // más. El `agente_id` se ordena por volumen y se numera: "Agente 1" es
      // simplemente el que más tickets lleva en el periodo filtrado, y ese
      // número no es estable entre filtros distintos ni identifica a nadie.
      db.query(
        `SELECT ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC)::int AS posicion,
                COUNT(*)::int AS tickets,
                COUNT(*) FILTER (WHERE cerrado IS NOT NULL)::int AS cerrados
           FROM ti_tickets
          WHERE ${where} AND agente_id IS NOT NULL
          GROUP BY agente_id ORDER BY 2 DESC`,
        params,
      ),

      // ------------------------------------------------------------ Backlog
      //
      // Los abiertos, con su antigüedad. No filtra por fecha de creación a
      // propósito: un ticket abierto desde hace dos años importa hoy aunque el
      // filtro del reporte apunte a este mes.
      //
      // Se trae también si tiene AGENTE, porque al cruzarlo aparece lo que de
      // verdad pasa con este backlog: los que llevan meses abiertos son casi
      // exactamente los mismos que nadie tomó. No es trabajo en proceso, es
      // trabajo sin dueño, y son dos problemas distintos.
      db.query(
        `SELECT numero, tema_corto AS tema,
                to_char(creado, 'YYYY-MM-DD HH24:MI') AS creado,
                ROUND(EXTRACT(EPOCH FROM (now() - creado)) / 86400.0)::int AS dias,
                primera_respuesta IS NOT NULL AS respondido,
                agente_id IS NOT NULL AS asignado
           FROM ti_tickets
          WHERE estado_grupo = 'open'
          ORDER BY creado ASC`,
      ),

      // -------------------------------------------- Los que más tardaron
      db.query(
        `SELECT numero, tema_corto AS tema,
                to_char(creado,  'YYYY-MM-DD HH24:MI') AS creado,
                to_char(cerrado, 'YYYY-MM-DD HH24:MI') AS cerrado,
                horas_resolucion AS horas,
                reabierto IS NOT NULL AS fue_reabierto
           FROM ti_tickets
          WHERE ${where} AND horas_resolucion IS NOT NULL
          ORDER BY horas_resolucion DESC LIMIT 15`,
        params,
      ),
    ]);

    // El reparto del equipo, en proporción
    const totalAsignado = equipo.rows.reduce((a, r) => a + r.tickets, 0);
    const agentes = equipo.rows.map((r) => ({
      posicion: r.posicion,
      etiqueta: `Agente ${r.posicion}`,
      tickets: r.tickets,
      cerrados: r.cerrados,
      parte: totalAsignado ? r.tickets / totalAsignado : null,
    }));

    return {
      agrupar: grupo,
      resumen: {
        ...leerIndicadores(resumen.rows[0]),
        desde: resumen.rows[0].desde,
        hasta: resumen.rows[0].hasta,
      },
      porTema: porTema.rows.map((r) => ({
        tema: r.tema,
        ...leerIndicadores(r),
        // Debajo del mínimo la mediana es ruido: se marca y no se grafica
        pocosDatos: r.cerrados < MINIMO_PARA_GRAFICAR,
      })),
      serie: serie.rows.map((r) => ({
        clave: r.clave,
        etiqueta: AGRUPACIONES[grupo].etiqueta(r.clave),
        ...leerIndicadores(r),
      })),
      equipo: {
        agentes,
        cuantos: agentes.length,
        // Qué tan concentrado está el trabajo. Con un solo agente llevando más
        // de la mitad, el área depende de una persona.
        parteDelMayor: agentes[0]?.parte ?? null,
        sinAsignar: resumen.rows[0].tickets - totalAsignado,
      },
      backlog: armarBacklog(backlog.rows),
      peores: peores.rows.map((r) => ({
        numero: r.numero,
        tema: r.tema,
        creado: r.creado,
        cerrado: r.cerrado,
        horas: num(r.horas),
        fueReabierto: r.fue_reabierto,
      })),
    };
  },
};

/**
 * Arma el backlog con su desglose por antigüedad.
 *
 * Los rangos no son decorativos: separan "todavía no da tiempo" de "esto ya se
 * perdió". Un ticket de tres días sin tomar es normal; uno de seis meses es
 * otra cosa.
 */
function armarBacklog(filas) {
  const dias = (t) => t.dias ?? 0;
  const rangos = [
    { clave: "reciente", etiqueta: "Menos de 7 días", hasta: 7 },
    { clave: "semanas", etiqueta: "7 a 30 días", hasta: 30 },
    { clave: "meses", etiqueta: "1 a 6 meses", hasta: 180 },
    { clave: "viejo", etiqueta: "Más de 6 meses", hasta: Infinity },
  ].map((r) => ({ ...r, tickets: 0, sinAsignar: 0 }));

  for (const t of filas) {
    const r = rangos.find((x) => dias(t) < x.hasta) || rangos[rangos.length - 1];
    r.tickets++;
    if (!t.asignado) r.sinAsignar++;
  }

  return {
    tickets: filas,
    total: filas.length,
    sinResponder: filas.filter((t) => !t.respondido).length,
    sinAsignar: filas.filter((t) => !t.asignado).length,
    // Los que llevan más de un mes abiertos: el problema de verdad
    masDeUnMes: filas.filter((t) => dias(t) >= 30).length,
    masViejo: filas[0] || null,
    porAntiguedad: rangos.map(({ hasta, ...r }) => r),
  };
}

module.exports = TiReporte;
module.exports.MINIMO_PARA_GRAFICAR = MINIMO_PARA_GRAFICAR;
module.exports.AGRUPACIONES = Object.keys(AGRUPACIONES);
