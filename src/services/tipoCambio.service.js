const cron = require("node-cron");
const db = require("../config/database");

/**
 * Tipo de cambio peso-dólar, FIX del Banco de México (serie SF43718 del SIE).
 *
 * Es el que se publica en el DOF y el que se usa para obligaciones en dólares
 * en México. Banxico lo determina cada día hábil al mediodía; aquí se baja dos
 * veces al día (12:30 y 18:00, L–V) y se guarda en `tipos_cambio`, así que los
 * reportes nunca dependen de que la API responda en ese momento. Los días sin
 * publicación (fines de semana, festivos) se usa el último guardado.
 *
 * Necesita un token del SIE (gratuito, se registra en
 * https://www.banxico.org.mx/SieAPIRest/service/v1/token) en BANXICO_TOKEN.
 * Sin token simplemente no se programa y la vista en dólares se apaga.
 */

const SERIE_FIX = "SF43718";
const API = "https://www.banxico.org.mx/SieAPIRest/service/v1/series";
const ZONA = "America/Mexico_City";
// Días hacia atrás en cada consulta: cubre un puente largo o el servidor apagado
const DIAS_ATRAS = 15;

const estado = { ultimoIntento: null, ultimoError: null };
let tareas = [];

const configurado = () => Boolean(process.env.BANXICO_TOKEN);

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** '28/10/2026' → '2026-10-28'. */
function fechaBanxico(s) {
  const m = String(s || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** '18.4567' (o '1,234.5') → número; 'N/E' (no hubo dato ese día) → null. */
function datoBanxico(s) {
  const t = String(s ?? "").replace(/,/g, "").trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** Los datos de la respuesta del SIE: [{ fecha: 'YYYY-MM-DD', valor }]. */
function leerRespuesta(json, serie) {
  const s = (json?.bmx?.series || []).find((x) => x.idSerie === serie);
  if (!s) throw new Error(`Banxico no devolvió la serie ${serie}`);
  return (s.datos || [])
    .map((d) => ({ fecha: fechaBanxico(d.fecha), valor: datoBanxico(d.dato) }))
    .filter((d) => d.fecha && d.valor != null);
}

/**
 * Baja los últimos días de la serie y los guarda. No duplica: un día que ya
 * estaba se actualiza (Banxico no corrige el FIX, pero así no truena).
 */
async function actualizar({ serie = SERIE_FIX, dias = DIAS_ATRAS } = {}) {
  if (!configurado()) throw new Error("Falta BANXICO_TOKEN en el .env");
  estado.ultimoIntento = new Date();
  try {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - dias * 86400000);
    const resp = await fetch(`${API}/${serie}/datos/${iso(desde)}/${iso(hasta)}`, {
      headers: { "Bmx-Token": process.env.BANXICO_TOKEN, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      throw new Error(
        resp.status === 401 || resp.status === 403
          ? "Banxico rechazó el token (revisa BANXICO_TOKEN)"
          : `Banxico respondió ${resp.status}`,
      );
    }
    const datos = leerRespuesta(await resp.json(), serie);
    for (const d of datos) {
      await db.query(
        `INSERT INTO tipos_cambio (serie, fecha, valor) VALUES ($1, $2, $3)
         ON CONFLICT (serie, fecha) DO UPDATE SET valor = EXCLUDED.valor, obtenido_en = now()`,
        [serie, d.fecha, d.valor],
      );
    }
    estado.ultimoError = null;
    return { guardados: datos.length, ultimo: await ultimo(serie) };
  } catch (e) {
    estado.ultimoError =
      e.name === "TimeoutError" ? "Banxico no respondió (sin salida a internet o servicio caído)" : e.message;
    throw new Error(estado.ultimoError);
  }
}

/** El último tipo de cambio guardado: { serie, fecha, valor, obtenido } o null. */
async function ultimo(serie = SERIE_FIX) {
  const { rows } = await db.query(
    `SELECT serie, to_char(fecha, 'YYYY-MM-DD') AS fecha, valor::float AS valor,
            to_char(obtenido_en, 'YYYY-MM-DD HH24:MI') AS obtenido
       FROM tipos_cambio WHERE serie = $1
      ORDER BY fecha DESC LIMIT 1`,
    [serie],
  );
  return rows[0] || null;
}

/** Lo que la pantalla necesita saber: el dato y si se puede actualizar. */
async function resumen(serie = SERIE_FIX) {
  return {
    ...(await ultimo(serie)),
    serie,
    fuente: "Banxico, FIX",
    configurado: configurado(),
    error: estado.ultimoError,
  };
}

function iniciarProgramado() {
  if (tareas.length) return;
  if (!configurado()) {
    console.log("💱 Tipo de cambio: sin BANXICO_TOKEN, no se programa");
    return;
  }
  const correr = () =>
    actualizar()
      .then((r) => r.ultimo && console.log(`💱 Tipo de cambio FIX ${r.ultimo.fecha}: ${r.ultimo.valor}`))
      .catch((e) => console.warn("⚠️  Tipo de cambio:", e.message));
  // Al arrancar, por si el servidor estuvo apagado
  correr();
  tareas = ["30 12 * * 1-5", "0 18 * * 1-5"].map((expr) => cron.schedule(expr, correr, { timezone: ZONA }));
}

function detenerProgramado() {
  for (const t of tareas) t.stop();
  tareas = [];
}

module.exports = {
  SERIE_FIX,
  actualizar,
  ultimo,
  resumen,
  leerRespuesta,
  iniciarProgramado,
  detenerProgramado,
};
