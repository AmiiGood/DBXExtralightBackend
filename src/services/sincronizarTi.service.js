const cron = require("node-cron");
const db = require("../config/database");
const osticket = require("../config/osticket");

/**
 * Sincronización de los tickets de TI desde osTicket.
 *
 * Mismo patrón que Moldes: trae de osTicket solo lo que cambió y lo deja en
 * `ti_tickets`. El reporte nunca toca osTicket, lee esta réplica.
 *
 *   Primera vez        todo el histórico del departamento (5,463 tickets,
 *                      unos cuatro segundos).
 *   Siguientes veces   los tickets cuyo `updated` sea posterior al corte de la
 *                      última corrida exitosa, con un traslape hacia atrás.
 *
 * El traslape existe porque los relojes de los dos servidores no son el mismo.
 * Volver a traer unas horas de más no cuesta nada: el UPSERT escribe encima del
 * mismo renglón.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SON DOS CONSULTAS Y NO UNA
 * ---------------------------------------------------------------------------
 * La primera respuesta vive en `ost_thread_entry` y la forma obvia de traerla
 * es un subquery correlacionado dentro de la consulta de tickets. Medido
 * contra el servidor real, esa forma tarda 8.3 segundos para 5,000 tickets, y
 * no mejora al achicar la página: el optimizador de MariaDB prefiere el índice
 * de `type` —que solo distingue dos valores— sobre el de `thread_id`, así que
 * el costo es casi fijo. 8.3 s está incómodamente cerca del
 * `max_statement_time` de 20 s que protege a osTicket, y una consulta que se
 * pasa del tope se aborta a medias.
 *
 * Separadas, con los ids de la página en un IN, el optimizador sí usa el
 * índice de `object_id`: 1.7 s los tickets y 2.5 s las respuestas, sin que
 * ninguna vuelta pase de 1.2 s. Diez veces más margen por el mismo resultado.
 */

/** Departamento de osTicket del que se traen los tickets. */
const DEPARTAMENTO = process.env.TI_OSTICKET_DEPARTAMENTO || "IT";

/** Cuánto se retrocede sobre el último corte para no dejar huecos. */
const TRASLAPE_HORAS = 6;

/** Tamaño del lote al escribir en Postgres. */
const LOTE = 2000;

/** Cuántos tickets se piden a osTicket por vuelta. */
const PAGINA = 2000;

/**
 * Cuántos ids caben en el IN de la consulta de primeras respuestas.
 *
 * Mil deja cada lote en medio segundo. Subirlo no gana nada y alarga la
 * consulta más larga, que es justo lo que se quiere evitar aquí.
 */
const LOTE_RESPUESTAS = 1000;

/**
 * Consulta de tickets.
 *
 * Se filtra por el departamento DEL TEMA y no por el del ticket, igual que
 * Moldes. Son criterios distintos: 102 tickets llegaron al departamento de TI
 * con un tema de otra área (Facilities, Mantto, hasta tres de Moldes) y 9 al
 * revés. Con este criterio esos 102 quedan fuera, que es lo acordado.
 */
const SQL_TICKETS = `
  SELECT t.ticket_id, t.number, h.topic,
         s.name AS estado, s.state AS estado_grupo,
         t.staff_id, t.created, t.closed, t.reopened, t.updated
    FROM ost_ticket t
    JOIN ost_help_topic h    ON h.topic_id = t.topic_id
    JOIN ost_department d    ON d.id = h.dept_id
    JOIN ost_ticket_status s ON s.id = t.status_id
   WHERE d.name = ?`;

/**
 * Primera respuesta de un agente, para un conjunto de tickets.
 *
 * `type = 'R'` es la respuesta de staff en osTicket; 'M' es el mensaje del
 * usuario. Se toma la más temprana del hilo.
 */
function sqlPrimerasRespuestas(cuantos) {
  const marcas = Array.from({ length: cuantos }, () => "?").join(",");
  return `
    SELECT th.object_id AS ticket_id, MIN(e.created) AS primera
      FROM ost_thread th
      JOIN ost_thread_entry e ON e.thread_id = th.id
     WHERE th.object_type = 'T'
       AND th.object_id IN (${marcas})
       AND e.type = 'R'
     GROUP BY th.object_id`;
}

/** Trae las primeras respuestas de una página y las deja en un Map. */
async function leerPrimerasRespuestas(ids) {
  const porTicket = new Map();
  for (let i = 0; i < ids.length; i += LOTE_RESPUESTAS) {
    const lote = ids.slice(i, i + LOTE_RESPUESTAS);
    const filas = await osticket.query(sqlPrimerasRespuestas(lote.length), lote);
    for (const f of filas) porTicket.set(Number(f.ticket_id), f.primera);
  }
  return porTicket;
}

/**
 * Lee de osTicket por páginas, avanzando por ticket_id.
 *
 * @param {String|null} desde      filtra por `updated`; null trae todo
 * @param {Function}    porPagina  recibe cada página ya con su primera respuesta
 */
async function leerPaginado(desde, porPagina) {
  let ultimoId = 0;
  let total = 0;
  let corte = null;

  for (;;) {
    let sql = `${SQL_TICKETS} AND t.ticket_id > ?`;
    const params = [DEPARTAMENTO, ultimoId];
    if (desde) {
      sql += " AND t.updated >= ?";
      params.push(desde);
    }
    // El LIMIT va literal: MySQL no acepta parámetro ahí en el protocolo
    // preparado, y es una constante nuestra, no entrada del usuario.
    sql += ` ORDER BY t.ticket_id ASC LIMIT ${PAGINA}`;

    const filas = await osticket.query(sql, params);
    if (filas.length === 0) break;

    const respuestas = await leerPrimerasRespuestas(
      filas.map((f) => Number(f.ticket_id)),
    );
    for (const f of filas) {
      f.primera_respuesta = respuestas.get(Number(f.ticket_id)) || null;
    }

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
 * osTicket guarda las fechas en la hora local de planta, sin zona. Mandarle un
 * corte en UTC lo movería seis horas hacia adelante y la sincronización se
 * saltaría los tickets de ese hueco.
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
 * Son `timestamp` sin zona. Si se dejan pasar tal cual, el driver las convierte
 * a Date y al serializarlas a JSON salen en UTC: una sincronización de las
 * 11:35 se mostraría como las 17:35.
 */
const FECHAS_TEXTO = `
    to_char(iniciada_en,       'YYYY-MM-DD HH24:MI:SS') AS iniciada_texto,
    to_char(terminada_en,      'YYYY-MM-DD HH24:MI:SS') AS terminada_texto,
    to_char(corte_actualizado, 'YYYY-MM-DD HH24:MI:SS') AS corte_texto`;

/** Última corrida que terminó bien. */
async function ultimaSincronizacion() {
  const { rows } = await db.query(
    `SELECT *, ${FECHAS_TEXTO}
       FROM ti_sincronizaciones
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
         FROM ti_tickets`,
    ),
    ultimaSincronizacion(),
    db.query(
      `SELECT *, ${FECHAS_TEXTO}
         FROM ti_sincronizaciones
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
 * UPSERT por ticket_id. Distingue insertados de actualizados por `xmax`, que
 * en un renglón recién insertado vale 0.
 */
async function escribirLote(cliente, filas) {
  if (filas.length === 0) return { nuevas: 0, modificadas: 0 };

  const cols = 11;
  const valores = [];
  const params = [];

  filas.forEach((f, i) => {
    const base = i * cols;
    valores.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, ` +
        `$${base + 11})`,
    );
    params.push(
      Number(f.ticket_id),
      String(f.number),
      f.topic,
      String(f.topic).replace(/^IT - /, ""),
      f.estado,
      f.estado_grupo,
      // staff_id 0 en osTicket significa "sin asignar", no el agente cero
      f.staff_id ? Number(f.staff_id) : null,
      f.created,
      f.closed || null,
      f.reopened || null,
      f.primera_respuesta || null,
    );
  });

  const { rows } = await cliente.query(
    `INSERT INTO ti_tickets
       (ticket_id, numero, tema, tema_corto, estado, estado_grupo,
        agente_id, creado, cerrado, reabierto, primera_respuesta)
     VALUES ${valores.join(", ")}
     ON CONFLICT (ticket_id) DO UPDATE SET
       numero            = EXCLUDED.numero,
       tema              = EXCLUDED.tema,
       tema_corto        = EXCLUDED.tema_corto,
       estado            = EXCLUDED.estado,
       estado_grupo      = EXCLUDED.estado_grupo,
       agente_id         = EXCLUDED.agente_id,
       creado            = EXCLUDED.creado,
       cerrado           = EXCLUDED.cerrado,
       reabierto         = EXCLUDED.reabierto,
       primera_respuesta = EXCLUDED.primera_respuesta,
       sincronizado_en   = now()
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
 */
async function sincronizar({ completa = false } = {}) {
  if (!osticket.configurado()) {
    throw new Error("Falta configurar la conexión a osTicket (OSTICKET_DB_*)");
  }

  const arranque = Date.now();
  const { rows: bitacora } = await db.query(
    "INSERT INTO ti_sincronizaciones DEFAULT VALUES RETURNING id",
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
    // queda como estaba en vez de con medio periodo cargado.
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");

      const resultado = await leerPaginado(filtroDesde, async (filas) => {
        for (let i = 0; i < filas.length; i += LOTE) {
          const r = await escribirLote(cliente, filas.slice(i, i + LOTE));
          nuevas += r.nuevas;
          modificadas += r.modificadas;
        }
      });

      leidas = resultado.total;
      if (resultado.corte && (!corte || resultado.corte > corte)) {
        corte = resultado.corte;
      }

      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }

    const duracion = Date.now() - arranque;
    await db.query(
      `UPDATE ti_sincronizaciones
          SET terminada_en = now(), exito = true, corte_actualizado = $2,
              filas_nuevas = $3, filas_modificadas = $4, duracion_ms = $5
        WHERE id = $1`,
      [corridaId, corte, nuevas, modificadas, duracion],
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
      `UPDATE ti_sincronizaciones
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
 * Cada cuánto se sincroniza. El reporte mide tiempos en horas, así que un
 * retraso de quince minutos no cambia ninguna decisión.
 */
const CADA_MINUTOS = Number(process.env.TI_SYNC_MINUTOS || 15);

let tarea = null;
let corriendo = false;

/** Arranca la sincronización periódica. */
function iniciarProgramado() {
  if (tarea) return;
  if (!osticket.configurado()) {
    console.warn("⚠️  TI: sin conexión a osTicket, no se programa la sincronización");
    return;
  }

  tarea = cron.schedule(`*/${CADA_MINUTOS} * * * *`, async () => {
    if (corriendo) {
      console.warn("⏭️  TI: se omite la sincronización, la anterior sigue en curso");
      return;
    }
    corriendo = true;
    try {
      const r = await sincronizar();
      if (r.nuevas || r.modificadas) {
        console.log(
          `🔄 TI: ${r.nuevas} tickets nuevos, ${r.modificadas} actualizados ` +
            `(${r.duracionMs} ms)`,
        );
      }
    } catch (e) {
      // Que falle una vuelta no es grave: el reporte sigue con el último corte
      // y la siguiente recupera lo pendiente gracias al traslape.
      console.error("⚠️  TI: falló la sincronización —", e.message);
    } finally {
      corriendo = false;
    }
  });

  console.log(`🕒 TI: sincronización con osTicket cada ${CADA_MINUTOS} min`);
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
  DEPARTAMENTO,
};
