const db = require("../config/database");

/**
 * Consultas de los reportes de STAFF.
 *
 * Sustituyen la presentación semanal, cuyas gráficas son capturas de pantalla
 * pegadas del Excel. Cuatro bloques:
 *
 *   INVOICE    pares facturados por BU contra su meta
 *   INYECCION  promedio diario de producción por BU contra su meta
 *   ENSAMBLE   igual que inyección
 *   ROTACION   plantilla, bajas, ausentismo y antigüedad
 *
 * Dos cosas que hay que tener presentes al leer este archivo:
 *
 *   1. El MES NO es la suma de sus semanas en todos los bloques. En INVOICE sí
 *      (son pares facturados), pero en INYECCION y ENSAMBLE el valor es un
 *      PROMEDIO DIARIO y el mes trae su propio promedio. Por eso nunca se
 *      recalcula un periodo a partir de otro: los dos se leen tal como vienen
 *      del Excel.
 *
 *   2. Las cifras de inyección y ensamble son las que captura STAFF, y NO
 *      coinciden con las del módulo de Inyección de este mismo sistema (en
 *      julio 2026: 19,480 contra 23,359 pares/día de Crocs Unfin). Son dos
 *      capturas distintas y aquí se respeta la de STAFF sin corregirla.
 */

/**
 * Cómo se arma el eje de la gráfica.
 *
 *   mes     solo los totales mensuales
 *   semana  solo las semanas
 *   junta   lo que hace la presentación a mano cada lunes: los meses ya
 *           cerrados del año, las últimas semanas sueltas y al final el mes en
 *           curso. Es la vista por omisión porque es la que se presenta.
 */
const VISTAS = ["junta", "mes", "semana"];

/** Semanas sueltas que enseña la vista 'junta'. Son las que trae el deck. */
const SEMANAS_JUNTA = 4;

const BLOQUES = ["INVOICE", "INYECCION", "ENSAMBLE", "ROTACION"];

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * Ordena los periodos como van en el eje: primero el año, y dentro de él los
 * meses y las semanas mezclados por la fecha en que caen.
 *
 * Un mes se ordena por su primera semana aproximada (mes × 4.345) para que
 * 'Julio' quede antes de 'Sem 32' y después de 'Sem 26'. Es una aproximación
 * a propósito: el Excel tampoco es exacto y lo único que se busca es que la
 * gráfica se lea de izquierda a derecha en orden cronológico.
 */
function ordenar(a, b) {
  if (a.anio !== b.anio) return a.anio - b.anio;
  const pos = (p) => (p.tipo === "MES" ? p.numero * 4.345 : p.numero);
  const d = pos(a) - pos(b);
  if (d !== 0) return d;
  // A igual posición, el mes va después: cierra el grupo de sus semanas
  return a.tipo === "MES" ? 1 : -1;
}

const StaffReporte = {
  /** Qué se puede filtrar: años con dato, bloques y cortes de PO abierta. */
  async getFiltros() {
    const [anios, bloques, cortes] = await Promise.all([
      db.query(
        `SELECT p.anio, COUNT(*)::int AS valores
           FROM staff_valores v
           JOIN staff_periodos p ON p.id = v.periodo_id
          GROUP BY 1 ORDER BY 1 DESC`,
      ),
      db.query(
        `SELECT m.bloque, COUNT(*)::int AS valores
           FROM staff_valores v
           JOIN staff_metricas m ON m.codigo = v.metrica_codigo
          GROUP BY 1 ORDER BY 1`,
      ),
      db.query(
        `SELECT corte_anio AS anio, corte_semana AS semana, COUNT(*)::int AS renglones
           FROM staff_open_po
          GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC`,
      ),
    ]);

    return {
      anios: anios.rows.map((r) => ({ anio: Number(r.anio), valores: r.valores })),
      bloques: bloques.rows,
      cortes: cortes.rows.map((r) => ({
        anio: Number(r.anio),
        semana: Number(r.semana),
        renglones: r.renglones,
      })),
      vistas: VISTAS,
    };
  },

  /**
   * Serie de un bloque, pivoteada para graficar.
   *
   * Devuelve un renglón por periodo con una llave por métrica, que es como lo
   * espera recharts, más el catálogo de métricas para saber cuál es meta de
   * cuál y en qué unidad va cada una.
   *
   * @param {String} bloque   INVOICE | INYECCION | ENSAMBLE | ROTACION
   * @param {Object} opciones { anio, vista, semanas }
   */
  async getSerie(bloque, opciones = {}) {
    if (!BLOQUES.includes(bloque)) {
      throw new Error(`Bloque desconocido: ${bloque}`);
    }
    const vista = VISTAS.includes(opciones.vista) ? opciones.vista : "junta";
    const semanasJunta = Number(opciones.semanas) || SEMANAS_JUNTA;

    const { rows: metricas } = await db.query(
      `SELECT codigo, nombre, serie, es_meta, unidad, orden
         FROM staff_metricas
        WHERE bloque = $1 AND activo
        ORDER BY orden`,
      [bloque],
    );

    const params = [bloque];
    let filtroAnio = "";
    if (opciones.anio) {
      params.push(opciones.anio);
      filtroAnio = `AND p.anio = $${params.length}`;
    }

    const { rows } = await db.query(
      `SELECT p.codigo, p.tipo, p.anio, p.numero, p.etiqueta,
              v.metrica_codigo, v.valor
         FROM staff_valores v
         JOIN staff_periodos p ON p.id = v.periodo_id
         JOIN staff_metricas m ON m.codigo = v.metrica_codigo
        WHERE m.bloque = $1 AND m.activo ${filtroAnio}`,
      params,
    );

    // Pivote: un renglón por periodo
    const porPeriodo = new Map();
    for (const r of rows) {
      let fila = porPeriodo.get(r.codigo);
      if (!fila) {
        fila = {
          clave: r.codigo,
          etiqueta: r.etiqueta,
          tipo: r.tipo,
          anio: Number(r.anio),
          numero: Number(r.numero),
        };
        porPeriodo.set(r.codigo, fila);
      }
      fila[r.metrica_codigo] = num(r.valor);
    }

    let periodos = [...porPeriodo.values()].sort(ordenar);

    if (vista === "mes") {
      periodos = periodos.filter((p) => p.tipo === "MES");
    } else if (vista === "semana") {
      periodos = periodos.filter((p) => p.tipo === "SEMANA");
    } else {
      periodos = vistaJunta(periodos, semanasJunta);
    }

    // Etiqueta corta para el eje: dentro de un año el año sobra y estorba
    const unSoloAnio = new Set(periodos.map((p) => p.anio)).size <= 1;
    for (const p of periodos) {
      p.eje = unSoloAnio ? p.etiqueta.replace(` ${p.anio}`, "") : p.etiqueta;
    }

    return { bloque, vista, metricas, periodos };
  },

  /**
   * Promedio por trimestre, que es la tabla de las diapositivas 6 y 8.
   *
   * Se promedian los valores SEMANALES del trimestre y no los mensuales: es lo
   * que más se acerca a la tabla hecha a mano (reproduce exacto el promedio
   * general de ensamble Crocs, 19,452) y evita que un mes con pocas semanas
   * capturadas pese igual que uno completo.
   *
   * No cuadra al 100% con la tabla del deck —hasta ~1% de diferencia en
   * algunas celdas—, porque esa se arma a mano y no está escrito con qué
   * corte. Aquí la definición queda fija y es reproducible.
   */
  async getPromedioTrimestre(bloque, anio) {
    if (!BLOQUES.includes(bloque)) {
      throw new Error(`Bloque desconocido: ${bloque}`);
    }

    const { rows } = await db.query(
      `SELECT m.codigo, m.nombre, m.serie, m.es_meta, m.unidad, m.orden,
              -- 13 semanas por trimestre; la 53 se suma a la cuarta
              LEAST(CEIL(p.numero / 13.0), 4)::int AS trimestre,
              AVG(v.valor)                         AS promedio,
              COUNT(*)::int                        AS semanas
         FROM staff_valores v
         JOIN staff_periodos p ON p.id = v.periodo_id
         JOIN staff_metricas m ON m.codigo = v.metrica_codigo
        WHERE m.bloque = $1 AND m.activo AND p.tipo = 'SEMANA' AND p.anio = $2
        GROUP BY m.codigo, m.nombre, m.serie, m.es_meta, m.unidad, m.orden, 7
        ORDER BY m.orden, 7`,
      [bloque, anio],
    );

    // Una fila por métrica con Q1..Q4 y el promedio general, que es como se
    // presenta: la tabla del deck tiene las BU en los renglones.
    const porMetrica = new Map();
    for (const r of rows) {
      let fila = porMetrica.get(r.codigo);
      if (!fila) {
        fila = {
          codigo: r.codigo,
          nombre: r.nombre,
          serie: r.serie,
          esMeta: r.es_meta,
          unidad: r.unidad,
          trimestres: {},
          general: null,
        };
        porMetrica.set(r.codigo, fila);
      }
      fila.trimestres[r.trimestre] = { promedio: num(r.promedio), semanas: r.semanas };
    }

    // El general se pondera por semanas para que un trimestre a medias no
    // cuente lo mismo que uno completo
    for (const fila of porMetrica.values()) {
      let suma = 0;
      let n = 0;
      for (const t of Object.values(fila.trimestres)) {
        suma += t.promedio * t.semanas;
        n += t.semanas;
      }
      fila.general = n ? suma / n : null;
    }

    return { bloque, anio: Number(anio), filas: [...porMetrica.values()] };
  },

  /**
   * Foto de PO abierta de un corte, y la lista de cortes archivados.
   *
   * Sin corte se devuelve el más reciente. `serie` viene pivoteada por mes de
   * entrega, que es como se grafica: una barra por BU en cada mes.
   */
  async getOpenPo(opciones = {}) {
    const { rows: cortes } = await db.query(
      `SELECT corte_anio AS anio, corte_semana AS semana
         FROM staff_open_po
        GROUP BY 1, 2 ORDER BY 1 DESC, 2 DESC`,
    );
    if (cortes.length === 0) {
      return { corte: null, cortes: [], entregas: [], bus: [], serie: [], totales: [] };
    }

    const corte =
      opciones.anio && opciones.semana
        ? { anio: Number(opciones.anio), semana: Number(opciones.semana) }
        : { anio: Number(cortes[0].anio), semana: Number(cortes[0].semana) };

    const { rows } = await db.query(
      `SELECT bu, entrega, orden, es_meta, cantidad
         FROM staff_open_po
        WHERE corte_anio = $1 AND corte_semana = $2
        ORDER BY orden, bu`,
      [corte.anio, corte.semana],
    );

    const entregas = [];
    const vistas = new Set();
    for (const r of rows) {
      if (!vistas.has(r.entrega)) {
        vistas.add(r.entrega);
        entregas.push({ entrega: r.entrega, orden: r.orden });
      }
    }
    entregas.sort((a, b) => a.orden - b.orden);

    const bus = [...new Set(rows.map((r) => r.bu))].sort();

    // Un renglón por mes de entrega, con una llave por BU y otra por su meta
    const porEntrega = new Map(
      entregas.map((e) => [e.entrega, { entrega: e.entrega, orden: e.orden }]),
    );
    for (const r of rows) {
      const fila = porEntrega.get(r.entrega);
      fila[r.es_meta ? `meta__${r.bu}` : r.bu] = num(r.cantidad);
    }

    // El total por BU se suma aquí y no se lee de la columna 'Total' del
    // Excel: así no hay dos versiones del mismo número.
    const totales = bus.map((bu) => ({
      bu,
      cantidad: rows
        .filter((r) => r.bu === bu && !r.es_meta)
        .reduce((a, r) => a + Number(r.cantidad), 0),
      meta: rows
        .filter((r) => r.bu === bu && r.es_meta)
        .reduce((a, r) => a + Number(r.cantidad), 0),
    }));

    return {
      corte,
      cortes: cortes.map((c) => ({ anio: Number(c.anio), semana: Number(c.semana) })),
      entregas: entregas.map((e) => e.entrega),
      bus,
      serie: [...porEntrega.values()].sort((a, b) => a.orden - b.orden),
      totales,
    };
  },
};

/**
 * La vista que se presenta en la junta: los meses cerrados del año, las
 * últimas semanas sueltas y al final el mes en curso.
 *
 * Es exactamente la selección de columnas que alguien arma a mano cada lunes
 * en el Excel. Con el archivo de la semana 35 da Ene..Jul, semanas 32 a 35 y
 * Agosto, que es lo que traen las diapositivas de facturación.
 */
function vistaJunta(periodos, cuantasSemanas) {
  if (periodos.length === 0) return [];

  const anio = Math.max(...periodos.map((p) => p.anio));
  const delAnio = periodos.filter((p) => p.anio === anio);
  const meses = delAnio.filter((p) => p.tipo === "MES");
  const semanas = delAnio.filter((p) => p.tipo === "SEMANA");

  if (meses.length === 0) return semanas.slice(-cuantasSemanas);

  const ultimoMes = Math.max(...meses.map((p) => p.numero));
  const cerrados = meses.filter((p) => p.numero < ultimoMes);
  const enCurso = meses.filter((p) => p.numero === ultimoMes);
  const recientes = semanas.slice(-cuantasSemanas);

  return [...cerrados, ...recientes, ...enCurso];
}

module.exports = StaffReporte;
module.exports.BLOQUES = BLOQUES;
module.exports.VISTAS = VISTAS;
