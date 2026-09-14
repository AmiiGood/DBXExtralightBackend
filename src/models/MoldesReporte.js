const db = require("../config/database");

/**
 * Consultas del reporte de Moldes.
 *
 * Lee `moldes_tickets`, la réplica local de osTicket. Nunca toca el servidor de
 * la mesa de ayuda: de eso se encarga sincronizarMoldes.service, cada 15 min.
 *
 * Cada ticket es una atención del área: se crea cuando piden el servicio y se
 * cierra cuando queda resuelto, así que el indicador es el TIEMPO DE
 * RESOLUCIÓN, ya calculado en la columna `horas_resolucion`.
 *
 * Sustituye al .pbix "Reporte Moldes, Cambio de Molde", con dos diferencias
 * deliberadas:
 *
 *   1. El Power BI estaba clavado en el tema "Moldes - Cambio de molde". Aquí
 *      el tema es un filtro, porque el área tiene 17 temas y los otros 16 suman
 *      unos 42 mil tickets que nadie estaba viendo.
 *
 *   2. El indicador principal es la MEDIANA, no el promedio. El promedio crudo
 *      es inservible: unos pocos tickets que quedaron olvidados meses lo mueven
 *      de 37 h en 2024 a 5 h en 2026, lo que parece una mejora del 85% y no lo
 *      es. La mediana del mismo periodo va de 4.42 h a 2.98 h — la mejora real.
 *      El promedio se sigue calculando, pero como dato secundario.
 */

/**
 * Cortes de la distribución de tiempos.
 *
 * Salen de la distribución real del área, no de números redondos: la mitad de
 * los tickets cae entre 1 y 4 horas, así que cortar más grueso aplastaría todo
 * en una sola barra.
 */
const RANGOS = [
  { clave: 1, etiqueta: "Menos de 1 h", hasta: 1 },
  { clave: 2, etiqueta: "1 a 4 h", hasta: 4 },
  { clave: 3, etiqueta: "4 a 8 h", hasta: 8 },
  { clave: 4, etiqueta: "8 a 24 h", hasta: 24 },
  { clave: 5, etiqueta: "1 a 3 días", hasta: 72 },
  { clave: 6, etiqueta: "Más de 3 días", hasta: null },
];

const CASE_RANGO = `CASE ${RANGOS.filter((r) => r.hasta !== null)
  .map((r) => `WHEN horas_resolucion < ${r.hasta} THEN ${r.clave}`)
  .join(" ")} ELSE 6 END`;

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Cómo se corta el eje temporal.
 *
 * La clave siempre lleva el año, incluso al agrupar por mes o semana: sin él,
 * "Marzo" de dos años distintos se dibujaría como un solo punto.
 */
const AGRUPACIONES = {
  anio: {
    sql: "to_char(creado, 'YYYY')",
    etiqueta: (c) => c,
  },
  mes: {
    sql: "to_char(creado, 'YYYY-MM')",
    etiqueta: (c) => `${MESES[Number(c.slice(5, 7)) - 1]} ${c.slice(0, 4)}`,
  },
  semana: {
    sql: "to_char(creado, 'IYYY-\"S\"IW')",
    etiqueta: (c) => `Sem ${c.slice(6)} ${c.slice(0, 4)}`,
  },
  fecha: {
    sql: "to_char(creado, 'YYYY-MM-DD')",
    etiqueta: (c) => c,
  },
};

const TIPOS_PERIODO = ["mes", "trimestre", "semestre", "anio"];

/**
 * Convierte un periodo (tipo + año + número) al rango de fechas que abarca.
 *
 * Se calcula aquí y no en el SQL para que las dos mitades de una comparación
 * usen exactamente el mismo criterio de corte, y para poder avisar cuando un
 * periodo todavía no termina.
 */
function rangoPeriodo(tipo, anio, numero) {
  const y = Number(anio);
  const n = Number(numero) || 1;
  const mesInicio =
    tipo === "trimestre" ? (n - 1) * 3 + 1
    : tipo === "semestre" ? (n - 1) * 6 + 1
    : tipo === "anio" ? 1
    : n;
  const dura =
    tipo === "trimestre" ? 3 : tipo === "semestre" ? 6 : tipo === "anio" ? 12 : 1;

  const dd = (v) => String(v).padStart(2, "0");
  // Día 0 del mes siguiente = último día del mes que interesa
  const ultimoDia = new Date(Date.UTC(y, mesInicio + dura - 1, 0)).getUTCDate();
  return {
    desde: `${y}-${dd(mesInicio)}-01`,
    hasta: `${y}-${dd(mesInicio + dura - 1)}-${dd(ultimoDia)}`,
  };
}

/**
 * Arma el WHERE compartido por todas las consultas.
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

  if (f.temas && f.temas.length) add("tema = ANY(?)", f.temas);
  if (f.fechaInicio) add("creado >= ?::date", f.fechaInicio);
  if (f.fechaFin) add("creado < ?::date + INTERVAL '1 day'", f.fechaFin);
  if (f.anio) add("EXTRACT(YEAR FROM creado) = ?", f.anio);
  if (f.mes) add("EXTRACT(MONTH FROM creado) = ?", f.mes);
  if (f.trimestre) add("EXTRACT(QUARTER FROM creado) = ?", f.trimestre);
  if (f.semestre) {
    params.push(f.semestre);
    cond.push(`CEIL(EXTRACT(MONTH FROM creado) / 6.0) = $${params.length}`);
  }
  if (f.semana) add("EXTRACT(WEEK FROM creado) = ?", f.semana);

  return { sql: cond.length ? cond.join("\n     AND ") : "TRUE", params };
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

const MoldesReporte = {
  /** Valores disponibles para los filtros de la pantalla. */
  async getFiltros() {
    const [temas, anios] = await Promise.all([
      db.query(
        `SELECT tema, tema_corto, COUNT(*)::int AS tickets
           FROM moldes_tickets
          GROUP BY tema, tema_corto
          ORDER BY tickets DESC`,
      ),
      db.query(
        `SELECT EXTRACT(YEAR FROM creado)::int AS anio, COUNT(*)::int AS tickets
           FROM moldes_tickets
          GROUP BY anio ORDER BY anio DESC`,
      ),
    ]);

    return {
      temas: temas.rows.map((t) => ({
        tema: t.tema,
        temaCorto: t.tema_corto,
        tickets: t.tickets,
      })),
      anios: anios.rows,
      meses: MESES.map((nombre, i) => ({ numero: i + 1, nombre })),
    };
  },

  /**
   * Todo lo que pinta la pantalla, en una sola llamada.
   *
   * @param {Object} filtros  temas, anio, mes, semana, trimestre, semestre, fechas
   * @param {String} agrupar  anio | mes | semana | fecha
   */
  async getDashboard(filtros = {}, agrupar = "mes") {
    const g = AGRUPACIONES[agrupar] || AGRUPACIONES.mes;
    const { sql: where, params } = construirFiltros(filtros);

    // Las métricas de tiempo solo miran tickets cerrados; los abiertos se
    // cuentan aparte para que se vea el rezago sin ensuciar los promedios.
    // horas_resolucion es NULL mientras el ticket sigue abierto, así que los
    // agregados ya los excluyen solos.
    const [resumen, serie, distribucion, porTema, porEstado, masLargos] =
      await Promise.all([
        db.query(
          `SELECT COUNT(*)::int                                    AS tickets,
                  COUNT(cerrado)::int                              AS cerrados,
                  COUNT(*) FILTER (WHERE cerrado IS NULL)::int     AS abiertos,
                  COUNT(reabierto)::int                            AS reabiertos,
                  to_char(MAX(creado), 'YYYY-MM-DD HH24:MI:SS')    AS ultimo_ticket,
                  AVG(horas_resolucion)                            AS media,
                  MIN(horas_resolucion)                            AS minimo,
                  MAX(horas_resolucion)                            AS maximo,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_resolucion) AS mediana,
                  percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_resolucion) AS p90
             FROM moldes_tickets
            WHERE ${where}`,
          params,
        ),
        db.query(
          `SELECT ${g.sql}            AS clave,
                  COUNT(*)::int       AS tickets,
                  COUNT(cerrado)::int AS cerrados,
                  AVG(horas_resolucion) AS media,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_resolucion) AS mediana,
                  percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_resolucion) AS p90
             FROM moldes_tickets
            WHERE ${where}
            GROUP BY clave ORDER BY clave`,
          params,
        ),
        db.query(
          `SELECT ${CASE_RANGO} AS rango, COUNT(*)::int AS tickets
             FROM moldes_tickets
            WHERE ${where} AND horas_resolucion IS NOT NULL
            GROUP BY rango ORDER BY rango`,
          params,
        ),
        db.query(
          `SELECT tema, tema_corto,
                  COUNT(*)::int       AS tickets,
                  COUNT(cerrado)::int AS cerrados,
                  AVG(horas_resolucion) AS media,
                  percentile_cont(0.5) WITHIN GROUP (ORDER BY horas_resolucion) AS mediana,
                  percentile_cont(0.9) WITHIN GROUP (ORDER BY horas_resolucion) AS p90
             FROM moldes_tickets
            WHERE ${where}
            GROUP BY tema, tema_corto ORDER BY tickets DESC`,
          params,
        ),
        db.query(
          `SELECT estado, estado_grupo, COUNT(*)::int AS tickets
             FROM moldes_tickets
            WHERE ${where}
            GROUP BY estado, estado_grupo ORDER BY tickets DESC`,
          params,
        ),
        db.query(
          // Las fechas se formatean en SQL a propósito. La columna es
          // `timestamp` sin zona: si se deja que el driver la convierta a Date,
          // el JSON sale en UTC y en pantalla se ven seis horas de más.
          //
          // Se incluye la reapertura porque osTicket solo guarda la ÚLTIMA
          // fecha de cierre: un ticket que se atendió en horas, se reabrió
          // meses después y se volvió a cerrar aparece con un tiempo de
          // resolución enorme que no corresponde al trabajo real. El
          // `065723`, el más largo de todos con 475 días, se cerró 6.6 h
          // después de haberse reabierto.
          `SELECT numero, tema_corto, estado, horas_resolucion,
                  to_char(creado,    'YYYY-MM-DD HH24:MI:SS') AS creado,
                  to_char(cerrado,   'YYYY-MM-DD HH24:MI:SS') AS cerrado,
                  to_char(reabierto, 'YYYY-MM-DD HH24:MI:SS') AS reabierto,
                  CASE WHEN reabierto IS NOT NULL
                       THEN EXTRACT(EPOCH FROM (cerrado - reabierto)) / 3600.0
                  END AS horas_tras_reabrir
             FROM moldes_tickets
            WHERE ${where} AND horas_resolucion IS NOT NULL
            ORDER BY horas_resolucion DESC LIMIT 10`,
          params,
        ),
      ]);

    const r = resumen.rows[0] || {};
    const totalCerrados = r.cerrados || 0;

    return {
      agrupacion: agrupar,
      resumen: {
        tickets: r.tickets || 0,
        cerrados: totalCerrados,
        abiertos: r.abiertos || 0,
        reabiertos: r.reabiertos || 0,
        ultimoTicket: r.ultimo_ticket || null,
        medianaHoras: num(r.mediana),
        p90Horas: num(r.p90),
        mediaHoras: num(r.media),
        minimoHoras: num(r.minimo),
        maximoHoras: num(r.maximo),
      },
      serie: serie.rows.map((s) => ({
        clave: s.clave,
        etiqueta: g.etiqueta(s.clave),
        tickets: s.tickets,
        cerrados: s.cerrados,
        mediana: num(s.mediana),
        p90: num(s.p90),
        media: num(s.media),
      })),
      distribucion: RANGOS.map((rango) => {
        const fila = distribucion.rows.find((d) => d.rango === rango.clave);
        const tickets = fila ? fila.tickets : 0;
        return {
          rango: rango.etiqueta,
          tickets,
          porcentaje: totalCerrados ? (tickets * 100) / totalCerrados : 0,
        };
      }),
      porTema: porTema.rows.map((t) => ({
        tema: t.tema,
        temaCorto: t.tema_corto,
        tickets: t.tickets,
        cerrados: t.cerrados,
        mediana: num(t.mediana),
        p90: num(t.p90),
        media: num(t.media),
      })),
      porEstado: porEstado.rows.map((e) => ({
        estado: e.estado,
        grupo: e.estado_grupo,
        tickets: e.tickets,
      })),
      masLargos: masLargos.rows.map((m) => ({
        numero: m.numero,
        tema: m.tema_corto,
        estado: m.estado,
        creado: m.creado,
        cerrado: m.cerrado,
        horas: num(m.horas_resolucion),
        reabierto: m.reabierto,
        horasTrasReabrir: num(m.horas_tras_reabrir),
      })),
    };
  },

  /**
   * Compara dos periodos del mismo tipo, igual que en el reporte de Inyección.
   *
   * @param {String} tipo   mes | trimestre | semestre | anio
   * @param {{anio: Number, numero: Number}} a
   * @param {{anio: Number, numero: Number}} b
   * @param {String[]} temas
   */
  async getComparativo(tipo, a, b, temas) {
    const t = TIPOS_PERIODO.includes(tipo) ? tipo : "mes";

    const armar = (p) => {
      const base = { temas, anio: p.anio };
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
      // to_char y no ::date: el driver convierte una fecha a Date de JS y
      // luego se compara como "Tue Sep 01", que no ordena contra "2026-12-31".
      db.query(
        "SELECT to_char(MAX(creado), 'YYYY-MM-DD') AS hasta FROM moldes_tickets",
      ),
    ]);

    // Sin base no hay porcentaje que calcular: mejor null que un infinito
    const variacion = (x, y) =>
      x === null || y === null || !x ? null : ((y - x) / x) * 100;

    /**
     * Un periodo que todavía no termina no se puede comparar de igual a igual
     * contra uno completo. Se marca para que la pantalla lo advierta en vez de
     * dejar que alguien lea "bajaron los tickets" cuando lo que pasa es que el
     * mes va a la mitad.
     */
    const hastaConDatos = ultimo.rows[0]?.hasta || null;
    const marcar = (p) => {
      const rango = rangoPeriodo(t, p.anio, p.numero);
      return {
        ...rango,
        parcial: Boolean(hastaConDatos && hastaConDatos < rango.hasta),
        hastaConDatos,
      };
    };

    // Comparación tema por tema. Se cruzan por nombre porque un tema puede
    // existir en un periodo y no en el otro; el que falte va en cero.
    const porNombre = new Map();
    for (const x of da.porTema) porNombre.set(x.tema, { a: x });
    for (const x of dbb.porTema) {
      porNombre.set(x.tema, { ...(porNombre.get(x.tema) || {}), b: x });
    }

    const delta = [...porNombre.entries()]
      .map(([tema, { a: ta, b: tb }]) => ({
        tema,
        temaCorto: (ta || tb).temaCorto,
        ticketsA: ta?.tickets ?? 0,
        ticketsB: tb?.tickets ?? 0,
        ticketsVariacion: variacion(ta?.tickets ?? 0, tb?.tickets ?? 0),
        medianaA: ta?.mediana ?? null,
        medianaB: tb?.mediana ?? null,
        medianaVariacion: variacion(ta?.mediana ?? null, tb?.mediana ?? null),
        p90A: ta?.p90 ?? null,
        p90B: tb?.p90 ?? null,
        // Cerrados de cada lado: con pocos tickets la mediana es ruido y la
        // pantalla necesita saberlo para no graficar cualquier cosa.
        cerradosA: ta?.cerrados ?? 0,
        cerradosB: tb?.cerrados ?? 0,
      }))
      .sort((x, y) => y.ticketsB + y.ticketsA - (x.ticketsB + x.ticketsA));

    return {
      tipo: t,
      a: { etiqueta: etiqueta(a), ...da.resumen, ...marcar(a), distribucion: da.distribucion },
      b: { etiqueta: etiqueta(b), ...dbb.resumen, ...marcar(b), distribucion: dbb.distribucion },
      delta,
      variacion: {
        tickets: variacion(da.resumen.tickets, dbb.resumen.tickets),
        mediana: variacion(da.resumen.medianaHoras, dbb.resumen.medianaHoras),
        p90: variacion(da.resumen.p90Horas, dbb.resumen.p90Horas),
        media: variacion(da.resumen.mediaHoras, dbb.resumen.mediaHoras),
      },
    };
  },
};

module.exports = MoldesReporte;
