const db = require("../config/database");

/**
 * Consultas del reporte de checadas.
 *
 * ---------------------------------------------------------------------------
 * LAS CHECADAS SE AGRUPAN EN JORNADAS
 * ---------------------------------------------------------------------------
 * En las catracas la gente entra y sale todo el día (comida, idas al almacén) y
 * a veces pasa dos veces seguidas por el lector. Si cada checada se leyera como
 * una entrada, la comida de las 12:30 de alguien del turno A saldría como
 * entrada al turno B, y su salida de las 16:25 como un retardo del B.
 *
 * Por eso, por cada persona y en orden de hora:
 *
 *   1. La primera checada ABRE una jornada. Su turno es el que tiene el inicio
 *      más cercano (no el rango donde cae la hora):
 *        07:51  → turno A, 9 min antes
 *        23:45  → turno C del DÍA SIGUIENTE, 15 min antes
 *      Por rango, 07:51 sería C y 23:45 sería B.
 *   2. Todo lo que cheque hasta el fin de ese turno más MARGEN_SALIDA (3 h) es
 *      de la misma jornada: comida, pasadas repetidas, salida.
 *   3. La ÚLTIMA checada de la jornada es la salida, si llega al menos
 *      MIN_SALIDA (4 h) después de la entrada. Antes de eso son pasadas
 *      intermedias, no una salida.
 *   4. Una checada después de esa ventana abre otra jornada.
 *
 * Lo que no queda bien:
 *   - Quien dobla turno (del A se queda al B): su entrada al B cae dentro de su
 *     jornada del A y no se ve como entrada nueva.
 *   - La salida del B después de las 00:00 solo se reconoce si el día anterior
 *     también está cargado; si no, se vería como entrada al C.
 *   - Con los archivos por ventana (7:50 a 8:20) no hay salidas: la columna sale
 *     vacía, que es lo correcto.
 *
 * Todo se calcula al consultar y no se guarda: si se corrige un horario o la
 * tolerancia en `chk_turnos`, lo cargado se recalcula solo.
 */

const MAX_DETALLE = 10000;
const MARGEN_SALIDA = 180; // minutos después del fin del turno que todavía son de la jornada
const MIN_SALIDA = 240; // minutos desde la entrada para que la última checada cuente como salida

const minutosDe = (hhmmss) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 60 + m + (s || 0) / 60;
};

/** Minutos desde una fecha fija: para comparar checadas de días distintos. */
const marca = (fecha, hora) => Date.parse(`${fecha}T00:00:00Z`) / 60000 + minutosDe(hora);

const sumarDias = (iso, dias) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

async function turnos() {
  const { rows } = await db.query(
    `SELECT clave, nombre, to_char(inicio, 'HH24:MI:SS') AS inicio, to_char(fin, 'HH24:MI:SS') AS fin,
            tolerancia_min, orden
       FROM chk_turnos ORDER BY orden`,
  );
  return rows.map((t) => {
    const inicioMin = minutosDe(t.inicio);
    // 23:59:59 es "hasta la medianoche": se redondea al minuto
    let duracion = Math.round(minutosDe(t.fin) - inicioMin);
    if (duracion <= 0) duracion += 1440;
    return { ...t, inicioMin, duracion };
  });
}

/**
 * El turno de una checada de entrada, la fecha de ese turno y los minutos contra
 * su hora de entrada (negativo = llegó antes).
 */
function asignarTurno(fecha, hora, listaTurnos) {
  const m = minutosDe(hora);
  let mejor = null;
  for (const t of listaTurnos) {
    let d = m - t.inicioMin;
    let dia = 0;
    if (d > 720) {
      d -= 1440;
      dia = 1;
    } else if (d <= -720) {
      d += 1440;
      dia = -1;
    }
    if (!mejor || Math.abs(d) < Math.abs(mejor.d)) mejor = { t, d, dia };
  }
  const minutos = Math.round(mejor.d);
  const estado =
    minutos <= 0 ? "A_TIEMPO" : minutos <= mejor.t.tolerancia_min ? "TOLERANCIA" : "RETARDO";
  return { turno: mejor.t.clave, fechaTurno: sumarDias(fecha, mejor.dia), minutos, estado, t: mejor.t };
}

/**
 * Arma las jornadas a partir de las checadas (ver arriba).
 *
 * @param {Array} filas  checadas { empleado_id, nombre, departamento, departamento_ruta,
 *                       punto, fecha 'YYYY-MM-DD', hora 'HH:MM:SS' }
 * @returns {Array} una jornada por persona y turno
 */
function armarJornadas(filas, listaTurnos) {
  const porPersona = new Map();
  for (const f of filas) {
    if (!porPersona.has(f.empleado_id)) porPersona.set(f.empleado_id, []);
    porPersona.get(f.empleado_id).push({ ...f, ts: marca(f.fecha, f.hora) });
  }

  const jornadas = [];
  for (const checadas of porPersona.values()) {
    checadas.sort((a, b) => a.ts - b.ts);
    let actual = null;
    for (const c of checadas) {
      if (actual && c.ts <= actual.limite) {
        actual.checadas++;
        actual.ultima = c;
        continue;
      }
      const a = asignarTurno(c.fecha, c.hora, listaTurnos);
      const inicioTurno = Date.parse(`${a.fechaTurno}T00:00:00Z`) / 60000 + a.t.inicioMin;
      actual = {
        primera: c,
        ultima: c,
        checadas: 1,
        asignado: a,
        finTurno: inicioTurno + a.t.duracion,
        limite: inicioTurno + a.t.duracion + MARGEN_SALIDA,
      };
      jornadas.push(actual);
    }
  }

  return jornadas.map((j) => {
    const p = j.primera;
    const u = j.ultima;
    const conSalida = u !== p && u.ts - p.ts >= MIN_SALIDA;
    const minutosSalida = conSalida ? Math.round(u.ts - j.finTurno) : null;
    return {
      empleado_id: p.empleado_id,
      nombre: p.nombre,
      departamento: p.departamento,
      departamento_ruta: p.departamento_ruta,
      punto: p.punto,
      turno: j.asignado.turno,
      fechaTurno: j.asignado.fechaTurno,
      // Entrada
      fecha: p.fecha,
      hora: p.hora.slice(0, 5),
      minutos: j.asignado.minutos,
      estado: j.asignado.estado,
      // Salida (null si la jornada no tiene)
      salidaFecha: conSalida ? u.fecha : null,
      salidaHora: conSalida ? u.hora.slice(0, 5) : null,
      salidaPunto: conSalida ? u.punto : null,
      minutosSalida,
      salioAntes: conSalida && minutosSalida < 0,
      checadas: j.checadas,
    };
  });
}

/** Fechas con checadas, departamentos y turnos, para los filtros. */
async function filtros() {
  const [rango, deps, listaTurnos] = await Promise.all([
    db.query(
      `SELECT to_char(MIN(fecha), 'YYYY-MM-DD') AS desde, to_char(MAX(fecha), 'YYYY-MM-DD') AS hasta
         FROM chk_transacciones`,
    ),
    db.query(
      `SELECT departamento, COUNT(DISTINCT empleado_id)::int AS personas
         FROM chk_transacciones WHERE departamento IS NOT NULL
        GROUP BY departamento ORDER BY departamento`,
    ),
    turnos(),
  ]);
  return {
    desde: rango.rows[0].desde,
    hasta: rango.rows[0].hasta,
    departamentos: deps.rows,
    turnos: listaTurnos.map(({ inicioMin, duracion, ...t }) => t),
  };
}

/**
 * El reporte de un rango de fechas.
 *
 * Las fechas son del TURNO: el C del 22 incluye a quien checó el 21 a las 23:45.
 * Por eso se leen las checadas desde un día antes y hasta un día después.
 *
 * @param {Object} f { desde, hasta, turnos[], departamentos[], estados[], salida, q }
 *   salida: 'ANTES' (salieron antes de terminar el turno) | 'SIN' (sin salida)
 */
async function reporte(f) {
  const listaTurnos = await turnos();
  const { rows } = await db.query(
    `SELECT empleado_id, nombre, departamento, departamento_ruta, punto,
            to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI:SS') AS hora
       FROM chk_transacciones
      WHERE fecha BETWEEN ($1::date - 1) AND ($2::date + 1)`,
    [f.desde, f.hasta],
  );

  const q = (f.q || "").trim().toLowerCase();
  const jornadas = armarJornadas(rows, listaTurnos).filter(
    (j) =>
      j.fechaTurno >= f.desde &&
      j.fechaTurno <= f.hasta &&
      (!f.turnos?.length || f.turnos.includes(j.turno)) &&
      (!f.departamentos?.length || f.departamentos.includes(j.departamento)) &&
      (!q || j.empleado_id.includes(q) || (j.nombre || "").toLowerCase().includes(q)),
  );

  let llegadas = jornadas;
  if (f.estados?.length) llegadas = llegadas.filter((l) => f.estados.includes(l.estado));
  if (f.salida === "ANTES") llegadas = llegadas.filter((l) => l.salioAntes);
  if (f.salida === "SIN") llegadas = llegadas.filter((l) => !l.salidaHora);

  const contar = (lista) => ({
    personas: lista.length,
    aTiempo: lista.filter((l) => l.estado === "A_TIEMPO").length,
    tolerancia: lista.filter((l) => l.estado === "TOLERANCIA").length,
    retardo: lista.filter((l) => l.estado === "RETARDO").length,
    conSalida: lista.filter((l) => l.salidaHora).length,
    salieronAntes: lista.filter((l) => l.salioAntes).length,
  });

  const agrupar = (clave) => {
    const g = new Map();
    for (const l of llegadas) {
      const k = clave(l);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(l);
    }
    return g;
  };

  const orden = Object.fromEntries(listaTurnos.map((t) => [t.clave, t.orden]));
  const porTurno = [...agrupar((l) => `${l.fechaTurno}|${l.turno}`)]
    .map(([k, lista]) => {
      const [fecha, turno] = k.split("|");
      return { fecha, turno, ...contar(lista) };
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || orden[a.turno] - orden[b.turno]);

  const porDepartamento = [...agrupar((l) => l.departamento || "(sin departamento)")]
    .map(([departamento, lista]) => ({ departamento, ...contar(lista) }))
    .sort((a, b) => b.personas - a.personas);

  const detalle = llegadas.sort(
    (a, b) =>
      b.fechaTurno.localeCompare(a.fechaTurno) ||
      orden[a.turno] - orden[b.turno] ||
      b.minutos - a.minutos ||
      (a.nombre || "").localeCompare(b.nombre || ""),
  );

  // Pasadas que no son ni la entrada ni la salida: comida, idas y vueltas,
  // pasadas repetidas por el lector
  const intermedias = llegadas.reduce((s, l) => s + l.checadas - 1 - (l.salidaHora ? 1 : 0), 0);

  return {
    resumen: {
      ...contar(llegadas),
      empleados: new Set(llegadas.map((l) => l.empleado_id)).size,
      intermedias,
    },
    porTurno,
    porDepartamento,
    detalle: detalle.slice(0, MAX_DETALLE),
    truncado: detalle.length > MAX_DETALLE,
    turnos: listaTurnos.map(({ inicioMin, duracion, ...t }) => t),
  };
}

module.exports = { filtros, reporte, asignarTurno, armarJornadas, turnos };
