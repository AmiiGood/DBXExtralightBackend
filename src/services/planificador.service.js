const cron = require("node-cron");
const db = require("../config/database");
const { ejecutarProgramacion } = require("./envioReportes.service");

/**
 * Planificador de reportes programados (node-cron).
 *
 * Mantiene en memoria una tarea por cada programación activa. Al crear, editar,
 * activar o borrar una programación hay que llamar a recargar() para que el
 * planificador se entere; si no, sigue con la versión vieja hasta el reinicio.
 *
 * OJO si algún día se levanta más de una instancia del backend: cada una
 * montaría sus propias tareas y los correos saldrían duplicados. Con una sola
 * instancia, que es el caso hoy, no hay problema.
 */

const tareas = new Map(); // id de programación -> tarea de node-cron

/**
 * Construye la expresión cron a partir de frecuencia + día + hora.
 * Se guarda en la BD para poder depurar qué se programó realmente.
 *
 *   DIARIA         m h * * *
 *   SEMANAL  dia   m h * * dia    (0 = domingo)
 *   MENSUAL  dia   m h dia * *
 */
function construirCron({ frecuencia, dia, hora, minuto }) {
  const m = Number(minuto) || 0;
  const h = Number(hora) || 0;
  if (frecuencia === "DIARIA") return `${m} ${h} * * *`;
  if (frecuencia === "MENSUAL") return `${m} ${h} ${Number(dia)} * *`;
  return `${m} ${h} * * ${Number(dia)}`;
}

/** Texto legible de cuándo se manda, para mostrarlo en pantalla. */
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function describirHorario({ frecuencia, dia, hora, minuto }) {
  const reloj = `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
  if (frecuencia === "DIARIA") return `todos los días a las ${reloj}`;
  if (frecuencia === "MENSUAL") return `el día ${dia} de cada mes a las ${reloj}`;
  return `todos los ${DIAS[dia] || "?"} a las ${reloj}`;
}

/** Quita todas las tareas montadas. */
function detenerTodas() {
  for (const [, tarea] of tareas) {
    try {
      tarea.stop();
      tarea.destroy?.();
    } catch {
      /* la tarea ya estaba muerta */
    }
  }
  tareas.clear();
}

/**
 * Lee las programaciones activas y monta una tarea por cada una.
 * Es idempotente: se puede llamar cuantas veces haga falta.
 */
async function recargar() {
  detenerTodas();

  const { rows } = await db.query(
    `SELECT p.*, l.nombre AS lista_nombre
       FROM reportes_programados p
       JOIN listas_correo l ON l.id = p.lista_id
      WHERE p.activo = true AND l.activo = true`,
  );

  for (const prog of rows) {
    const expresion = prog.expresion_cron || construirCron(prog);
    if (!cron.validate(expresion)) {
      console.error(
        `⚠️  Programación "${prog.nombre}" (id ${prog.id}) tiene una expresión cron inválida: ${expresion}`,
      );
      continue;
    }

    const tarea = cron.schedule(
      expresion,
      async () => {
        console.log(`📧 Ejecutando "${prog.nombre}" (id ${prog.id})...`);
        const r = await ejecutarProgramacion(prog, { disparo: "PROGRAMADO" });
        console.log(
          r.ok
            ? `   ✅ enviado a ${r.destinatarios.length} destinatarios (${r.periodo})`
            : `   ❌ ${r.error}`,
        );
      },
      { timezone: prog.zona_horaria || "America/Mexico_City" },
    );

    tareas.set(prog.id, tarea);
  }

  console.log(`🗓️  Planificador: ${tareas.size} programaciones activas`);
  return tareas.size;
}

/** Cuántas tareas hay montadas y cuándo corre cada una. */
function estado() {
  return [...tareas.entries()].map(([id, tarea]) => {
    let proxima = null;
    try {
      proxima = tarea.getNextRun?.() ?? null;
    } catch {
      /* según la versión puede no estar disponible */
    }
    return { programadoId: id, proximaEjecucion: proxima };
  });
}

module.exports = {
  recargar,
  detenerTodas,
  estado,
  construirCron,
  describirHorario,
};
