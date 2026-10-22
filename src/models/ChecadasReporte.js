const db = require("../config/database");

/**
 * Consultas del reporte de checadas.
 *
 * ---------------------------------------------------------------------------
 * A QUÉ TURNO VA UNA CHECADA
 * ---------------------------------------------------------------------------
 * Al turno cuyo INICIO está más cerca, no al rango donde cae la hora:
 *
 *   07:51  → Turno A (empieza a las 8:00), 9 minutos antes
 *   08:08  → Turno A, 8 minutos después
 *   23:45  → Turno C del DÍA SIGUIENTE (empieza a las 00:00), 15 minutos antes
 *
 * Por rango, 07:51 saldría como turno C y 23:45 como turno B. Como los turnos
 * son de 8 horas, ninguna checada queda a más de 4 horas de un inicio.
 *
 * Esto supone que lo que se carga son ENTRADAS: RH descarga la ventana de cada
 * cambio de turno (7:50 a 8:20…). Una salida a las 16:05 se leería como entrada
 * del turno B.
 *
 * ---------------------------------------------------------------------------
 * UNA PERSONA, UN TURNO, UNA CHECADA
 * ---------------------------------------------------------------------------
 * Si alguien pasa dos o tres veces por el lector (07:53, 07:53, 07:56), cuenta
 * la primera. Las demás solo se reportan como "checadas repetidas".
 *
 * El turno se calcula al consultar y no se guarda: si se corrige el horario o
 * la tolerancia en `chk_turnos`, todo lo cargado se recalcula solo.
 */

const MAX_DETALLE = 10000;

const minutosDe = (hhmmss) => {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 60 + m + (s || 0) / 60;
};

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
  return rows.map((t) => ({ ...t, inicioMin: minutosDe(t.inicio) }));
}

/**
 * El turno, la fecha del turno y los minutos contra la hora de entrada.
 *
 * @returns {Object} { turno, fechaTurno, minutos, estado }
 *   minutos < 0 = llegó antes; estado A_TIEMPO | TOLERANCIA | RETARDO
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
  return { turno: mejor.t.clave, fechaTurno: sumarDias(fecha, mejor.dia), minutos, estado };
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
    turnos: listaTurnos.map(({ inicioMin, ...t }) => t),
  };
}

/**
 * El reporte de un rango de fechas.
 *
 * Las fechas son del TURNO: el C del 22 incluye a quien checó el 21 a las 23:45.
 * Por eso se leen las checadas desde un día antes y hasta un día después.
 *
 * @param {Object} f { desde, hasta, turnos[], departamentos[], estados[], q }
 */
async function reporte(f) {
  const listaTurnos = await turnos();
  const { rows } = await db.query(
    `SELECT empleado_id, nombre, departamento, departamento_ruta, punto,
            to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI:SS') AS hora
       FROM chk_transacciones
      WHERE fecha BETWEEN ($1::date - 1) AND ($2::date + 1)
      ORDER BY fecha, hora`,
    [f.desde, f.hasta],
  );

  const q = (f.q || "").trim().toLowerCase();
  const porPersonaTurno = new Map();
  for (const r of rows) {
    const a = asignarTurno(r.fecha, r.hora, listaTurnos);
    if (a.fechaTurno < f.desde || a.fechaTurno > f.hasta) continue;
    if (f.turnos?.length && !f.turnos.includes(a.turno)) continue;
    if (f.departamentos?.length && !f.departamentos.includes(r.departamento)) continue;
    if (q && !r.empleado_id.includes(q) && !(r.nombre || "").toLowerCase().includes(q)) continue;

    const llave = `${r.empleado_id}|${a.fechaTurno}|${a.turno}`;
    const previa = porPersonaTurno.get(llave);
    if (previa) {
      previa.checadas++;
      continue;
    }
    porPersonaTurno.set(llave, {
      empleado_id: r.empleado_id,
      nombre: r.nombre,
      departamento: r.departamento,
      departamento_ruta: r.departamento_ruta,
      punto: r.punto,
      fecha: r.fecha,
      hora: r.hora.slice(0, 5),
      ...a,
      checadas: 1,
    });
  }

  let llegadas = [...porPersonaTurno.values()];
  if (f.estados?.length) llegadas = llegadas.filter((l) => f.estados.includes(l.estado));

  const contar = (lista) => ({
    personas: lista.length,
    aTiempo: lista.filter((l) => l.estado === "A_TIEMPO").length,
    tolerancia: lista.filter((l) => l.estado === "TOLERANCIA").length,
    retardo: lista.filter((l) => l.estado === "RETARDO").length,
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

  const detalle = llegadas
    .sort(
      (a, b) =>
        b.fechaTurno.localeCompare(a.fechaTurno) ||
        orden[a.turno] - orden[b.turno] ||
        b.minutos - a.minutos ||
        (a.nombre || "").localeCompare(b.nombre || ""),
    );

  return {
    resumen: {
      ...contar(llegadas),
      empleados: new Set(llegadas.map((l) => l.empleado_id)).size,
      repetidas: llegadas.reduce((s, l) => s + l.checadas - 1, 0),
    },
    porTurno,
    porDepartamento,
    detalle: detalle.slice(0, MAX_DETALLE),
    truncado: detalle.length > MAX_DETALLE,
    turnos: listaTurnos.map(({ inicioMin, ...t }) => t),
  };
}

module.exports = { filtros, reporte, asignarTurno, turnos };
