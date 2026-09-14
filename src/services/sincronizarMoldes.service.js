const cron = require("node-cron");
const db = require("../config/database");
const osticket = require("../config/osticket");

/**
 * Sincronización de los tickets de Moldes desde osTicket.
 *
 * Trae de osTicket solo lo que cambió y lo deja en `moldes_tickets`. El reporte
 * nunca toca osTicket: lee esta réplica.
 *
 * Cómo decide qué traer:
 *
 *   Primera vez        todo el histórico del departamento (~109 mil tickets,
 *                      alrededor de un minuto).
 *   Siguientes veces   los tickets cuyo `updated` sea posterior al corte de la
 *                      última corrida exitosa, con un traslape hacia atrás.
 *
 * El traslape existe porque los relojes de los dos servidores no son el mismo.
 * Si osTicket va unos minutos atrasado, cortar exactamente en el último valor
 * visto dejaría fuera tickets que se guardaron mientras corría la
 * sincronización. Volver a traer unas horas de más no cuesta nada: el UPSERT
 * escribe encima del mismo renglón.
 */

/** Cuánto se retrocede sobre el último corte para no dejar huecos. */
const TRASLAPE_HORAS = 6;

/** Tamaño del lote al escribir en Postgres. */
const LOTE = 2000;

/**
 * Cuántos tickets se piden a osTicket por vuelta.
 *
 * La lectura se pagina aunque el resultado quepa en memoria. Traer los 109 mil
 * tickets de un jalón tardaba 14 segundos contra el servidor real, peligrosamente
 * cerca del `max_statement_time` de 20 s — y una consulta que se pasa del tope
 * se aborta a medias. Paginado por `ticket_id`, que es la llave primaria, cada
 * vuelta termina en menos de un segundo y el tope nunca se acerca.
 */
const PAGINA = 5000;

/**
 * Consulta de osTicket.
 *
 * Une los catálogos (tema, departamento, estado) aquí y no en el reporte: son
 * tablas de decenas de filas, el join es barato, y guardar el texto ya resuelto
 * evita replicar tres tablas más.
 */
const SQL_ORIGEN = `
  SELECT t.ticket_id, t.number, h.topic, d.name AS departamento,
         s.name AS estado, s.state AS estado_grupo,
         t.created, t.closed, t.reopened, t.updated
    FROM ost_ticket t
    JOIN ost_help_topic h    ON h.topic_id = t.topic_id
    JOIN ost_department d    ON d.id = h.dept_id
    JOIN ost_ticket_status s ON s.id = t.status_id
   WHERE d.name = ?`;

/**
 * Lee de osTicket por páginas, avanzando por ticket_id.
 *
 * @param {String|null} desde  filtra por `updated`; null trae todo el histórico
 * @param {Function}    porPagina  recibe cada página; se procesa y se suelta
 */
async function leerPaginado(desde, porPagina) {
  let ultimoId = 0;
  let total = 0;
  let corte = null;

  for (;;) {
    let sql = `${SQL_ORIGEN} AND t.ticket_id > ?`;
    const params = ["Moldes", ultimoId];
    if (desde) {
      sql += " AND t.updated >= ?";
      params.push(desde);
    }
    // El LIMIT va literal: MySQL no acepta parámetro ahí en el protocolo
    // preparado, y es una constante nuestra, no entrada del usuario.
    sql += ` ORDER BY t.ticket_id ASC LIMIT ${PAGINA}`;

    const filas = await osticket.query(sql, params);
    if (filas.length === 0) break;

    await porPagina(filas);

    total += filas.length;
    ultimoId = Number(filas[filas.length - 1].ticket_id);
    for (const f of filas) {
      if (f.updated && (!corte || f.updated > corte)) corte = f.updated;
    }

    if (filas.length < PAGINA) break;
  }

  return { total, corte };
}

/**
 * Formatea una fecha como texto en HORA LOCAL, no en UTC.
 *
 * osTicket guarda `created`, `closed` y `updated` en la hora local de planta,
 * sin zona. Mandarle un corte en UTC lo movería seis horas hacia adelante y la
 * sincronización se saltaría los tickets de ese hueco.
 */
function aTextoLocal(fecha) {
  const dd = (v) => String(v).padStart(2, "0");
  return (
    `${fecha.getFullYear()}-${dd(fecha.getMonth() + 1)}-${dd(fecha.getDate())} ` +
    `${dd(fecha.getHours())}:${dd(fecha.getMinutes())}:${dd(fecha.getSeconds())}`
  );
}

/**
 * Columnas de fecha ya formateadas como texto.
 *
 * Las columnas son `timestamp` sin zona. Si se dejan pasar tal cual, el driver
 * las convierte a Date de JS y al serializarlas a JSON salen en UTC: una
 * sincronización de las 11:35 se muestra como las 17:35. Se formatean en SQL
 * para que lo que viaja sea exactamente la hora que se guardó.
 */
const FECHAS_TEXTO = `
    to_char(iniciada_en,       'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto,
    to_char(terminada_en,      'YYYY-MM-DD HH24:MI:SS') AS terminada_texto,
    to_char(corte_actualizado, 'YYYY-MM-DD HH24:MI:SS') AS corte_texto`;

/**
 * Última corrida que terminó bien.
 * @returns {Promise<Object|null>}
 */
async function ultimaSincronizacion() {
  const { rows } = await db.query(
    `SELECT *, ${FECHAS_TEXTO}
       FROM moldes_sincronizaciones
      WHERE exito IS TRUE
      ORDER BY iniciada_en DESC LIMIT 1`,
  );
  return rows[0] || null;
}

/** Estado actual de la réplica, para mostrarlo en pantalla. */
async function estado() {
  const [replica, ultima, corriendo] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS tickets,
              to_char(MIN(creado),          'YYYY-MM-DD HH24:MI:SS') AS desde,
              to_char(MAX(creado),          'YYYY-MM-DD HH24:MI:SS') AS hasta,
              to_char(MAX(sincronizado_en), 'YYYY-MM-DD HH24:MI:SS') AS ultimo_cambio
         FROM moldes_tickets`,
    ),
    ultimaSincronizacion(),
    db.query(
      `SELECT *, ${FECHAS_TEXTO}
         FROM moldes_sincronizaciones
        WHERE terminada_en IS NULL
        ORDER BY iniciada_en DESC LIMIT 1`,
    ),
  ]);

  return {
    ...replica.rows[0],
    ultimaSincronizacion: ultima,
    enCurso: corriendo.rows[0] || null,
  };
}

/**
 * Escribe un lote en Postgres.
 *
 * UPSERT por ticket_id: un ticket que ya existía y cambió de estado o se cerró
 * se pisa con lo nuevo. Devuelve cuántos se insertaron y cuántos se
 * actualizaron, distinguiéndolos por `xmax`, que en un renglón recién insertado
 * vale 0.
 */
async function escribirLote(cliente, filas) {
  if (filas.length === 0) return { nuevas: 0, modificadas: 0 };

  const cols = 10;
  const valores = [];
  const params = [];

  filas.forEach((f, i) => {
    const base = i * cols;
    valores.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`,
    );
    params.push(
      Number(f.ticket_id),
      String(f.number),
      f.topic,
      String(f.topic).replace(/^Moldes - /, ""),
      f.departamento,
      f.estado,
      f.estado_grupo,
      f.created,
      f.closed || null,
      f.reopened || null,
    );
  });

  const { rows } = await cliente.query(
    `INSERT INTO moldes_tickets
       (ticket_id, numero, tema, tema_corto, departamento,
        estado, estado_grupo, creado, cerrado, reabierto)
     VALUES ${valores.join(", ")}
     ON CONFLICT (ticket_id) DO UPDATE SET
       numero          = EXCLUDED.numero,
       tema            = EXCLUDED.tema,
       tema_corto      = EXCLUDED.tema_corto,
       departamento    = EXCLUDED.departamento,
       estado          = EXCLUDED.estado,
       estado_grupo    = EXCLUDED.estado_grupo,
       creado          = EXCLUDED.creado,
       cerrado         = EXCLUDED.cerrado,
       reabierto       = EXCLUDED.reabierto,
       sincronizado_en = now()
     RETURNING (xmax = 0) AS insertado`,
    params,
  );

  const nuevas = rows.filter((r) => r.insertado).length;
  return { nuevas, modificadas: rows.length - nuevas };
}

/**
 * Corre una sincronización.
 *
 * @param {Object}  opciones
 * @param {Boolean} opciones.completa  ignora el corte y trae todo de nuevo
 * @returns {Promise<Object>} resumen de la corrida
 */
async function sincronizar({ completa = false } = {}) {
  if (!osticket.configurado()) {
    throw new Error("Falta configurar la conexión a osTicket (OSTICKET_DB_*)");
  }

  const arranque = Date.now();
  const { rows: bitacora } = await db.query(
    "INSERT INTO moldes_sincronizaciones DEFAULT VALUES RETURNING id",
  );
  const corridaId = bitacora[0].id;

  try {
    const ultima = completa ? null : await ultimaSincronizacion();
    let desde = null;
    if (ultima?.corte_actualizado) {
      desde = new Date(ultima.corte_actualizado);
      desde.setHours(desde.getHours() - TRASLAPE_HORAS);
    }

    const filtroDesde = desde ? aTextoLocal(desde) : null;

    let nuevas = 0;
    let modificadas = 0;
    let leidas = 0;
    let corte = ultima?.corte_actualizado || null;

    // Todo va en una transacción: si algo revienta a la mitad, la réplica se
    // queda como estaba en vez de quedar con medio periodo cargado.
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");

      const resultado = await leerPaginado(filtroDesde, async (pagina) => {
        for (let i = 0; i < pagina.length; i += LOTE) {
          const r = await escribirLote(cliente, pagina.slice(i, i + LOTE));
          nuevas += r.nuevas;
          modificadas += r.modificadas;
        }
      });

      await cliente.query("COMMIT");
      leidas = resultado.total;
      // El corte sale del dato, no del reloj de este servidor: es el `updated`
      // más alto que realmente se alcanzó a traer.
      if (resultado.corte) corte = resultado.corte;
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const duracion = Date.now() - arranque;
    await db.query(
      `UPDATE moldes_sincronizaciones
          SET terminada_en = now(), exito = true, corte_actualizado = $2,
              filas_nuevas = $3, filas_modificadas = $4, duracion_ms = $5,
              mensaje = $6
        WHERE id = $1`,
      [
        corridaId,
        corte,
        nuevas,
        modificadas,
        duracion,
        completa ? "Carga completa" : "Incremental",
      ],
    );

    return {
      id: corridaId,
      completa,
      leidas,
      nuevas,
      modificadas,
      corte,
      duracionMs: duracion,
    };
  } catch (error) {
    await db.query(
      `UPDATE moldes_sincronizaciones
          SET terminada_en = now(), exito = false, duracion_ms = $2, mensaje = $3
        WHERE id = $1`,
      [corridaId, Date.now() - arranque, error.message],
    );
    throw error;
  }
}

// =============================================
// PROGRAMACIÓN
// =============================================

/**
 * Cada cuánto se sincroniza. El reporte mide tiempos de atención en horas, así
 * que un retraso de quince minutos no cambia ninguna decisión, y a osTicket le
 * llega una consulta liviana en vez de siete pesadas por cada visita.
 */
const CADA_MINUTOS = Number(process.env.MOLDES_SYNC_MINUTOS || 15);

let tarea = null;
let corriendo = false;

/**
 * Arranca la sincronización periódica.
 *
 * Se salta la vuelta si la anterior sigue corriendo: la carga completa tarda
 * casi tres minutos y dos corridas encimadas pelearían por la misma tabla.
 */
function iniciarProgramado() {
  if (tarea) return;
  if (!osticket.configurado()) {
    console.warn("⚠️  Moldes: sin conexión a osTicket, no se programa la sincronización");
    return;
  }

  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, async () => {
    if (corriendo) {
      console.warn("⏭️  Moldes: se omite la sincronización, la anterior sigue en curso");
      return;
    }
    corriendo = true;
    try {
      const r = await sincronizar();
      if (r.nuevas || r.modificadas) {
        console.log(
          `🔄 Moldes: ${r.nuevas} tickets nuevos, ${r.modificadas} actualizados ` +
            `(${r.duracionMs} ms)`,
        );
      }
    } catch (e) {
      // Que falle una vuelta no es grave: el reporte sigue con el último corte
      // y la siguiente vuelta recupera lo pendiente gracias al traslape.
      console.error("⚠️  Moldes: falló la sincronización —", e.message);
    } finally {
      corriendo = false;
    }
  });

  console.log(`🕒 Moldes: sincronización con osTicket cada ${CADA_MINUTOS} min`);
}

function detenerProgramado() {
  if (!tarea) return;
  tarea.stop();
  tarea = null;
}

module.exports = {
  sincronizar,
  estado,
  ultimaSincronizacion,
  iniciarProgramado,
  detenerProgramado,
};
