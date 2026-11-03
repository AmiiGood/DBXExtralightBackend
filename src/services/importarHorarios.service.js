const db = require("../config/database");
const { parsearHorarios } = require("../utils/horariosExcelParser");

/**
 * Carga del libro de horarios especiales de RH.
 *
 * Cada carga REEMPLAZA la lista completa: es la plantilla vigente de quién
 * tiene otro horario, y quien ya no viene en el libro regresa a los turnos
 * generales (C, A, B).
 *
 * Cada horario del libro ("8:30 a 18:00") se busca en `chk_turnos` por hora de
 * inicio y fin. Si no existe se da de alta como turno especial ("E1", "E2"…),
 * con la tolerancia de planta.
 */

const TOLERANCIA = 20;

const llave = (o) => `${o.inicio}-${o.fin}`;

async function turnosPorHorario(cliente = db) {
  const { rows } = await cliente.query(
    `SELECT clave, nombre, to_char(inicio, 'HH24:MI') AS inicio, to_char(fin, 'HH24:MI') AS fin, especial
       FROM chk_turnos ORDER BY orden`,
  );
  // 23:59:59 se escribe "24:00" en un horario; los dos son el fin del día
  return new Map(rows.map((t) => [`${t.inicio}-${t.fin === "23:59" ? "24:00" : t.fin}`, t]));
}

/** Lo que trae el libro, cruzado con los turnos y con la lista actual. */
async function leer(archivo) {
  const r = parsearHorarios(archivo);
  const turnos = await turnosPorHorario();
  const { rows: actuales } = await db.query("SELECT empleado_id, turnos FROM chk_horarios");
  const antes = new Map(actuales.map((a) => [a.empleado_id, a.turnos]));

  // Un grupo por combinación de horarios: "Administrativo", "Compuestos día o noche"…
  const grupos = new Map();
  for (const p of r.personas) {
    const k = p.opciones.map(llave).join(" / ");
    if (!grupos.has(k)) {
      grupos.set(k, {
        opciones: p.opciones.map((o) => ({ ...o, turno: turnos.get(llave(o)) || null })),
        perfiles: new Set(),
        personas: 0,
      });
    }
    const g = grupos.get(k);
    g.personas++;
    if (p.perfil) g.perfiles.add(p.perfil);
  }

  const nuevas = r.personas.filter((p) => !antes.has(p.empleado_id)).length;
  const salen = actuales.filter((a) => !r.personas.some((p) => p.empleado_id === a.empleado_id)).length;

  return {
    ...r,
    turnos,
    grupos: [...grupos.values()].map((g) => ({ ...g, perfiles: [...g.perfiles] })),
    cambios: { nuevas, salen, siguen: r.personas.length - nuevas, antes: actuales.length },
  };
}

/** Lo que trae el libro, sin escribir nada. */
async function analizarArchivo(archivo) {
  const r = await leer(archivo);
  return {
    hoja: r.hoja,
    personas: r.personas.length,
    grupos: r.grupos,
    cambios: r.cambios,
    // Horarios que todavía no son turno: se darán de alta al cargar
    turnosNuevos: [...new Set(r.grupos.flatMap((g) => g.opciones.filter((o) => !o.turno).map(llave)))],
    avisos: r.avisos,
  };
}

/** Siguiente clave libre para un turno creado al cargar: E1, E2… */
async function siguienteClave(cliente) {
  const { rows } = await cliente.query(
    `SELECT coalesce(max(substring(clave FROM 2)::int), 0) + 1 AS n FROM chk_turnos WHERE clave ~ '^E[0-9]+$'`,
  );
  return `E${rows[0].n}`;
}

/**
 * Carga el libro y reemplaza la lista.
 * @param {Object} opciones { usuarioId, nombreArchivo }
 */
async function importarArchivo(archivo, opciones = {}) {
  const r = parsearHorarios(archivo);
  if (r.personas.length === 0) {
    const e = new Error("El archivo no trae ninguna persona con horario");
    e.statusCode = 400;
    throw e;
  }

  const cliente = await db.pool.connect();
  try {
    await cliente.query("BEGIN");
    const turnos = await turnosPorHorario(cliente);
    const creados = [];
    for (const p of r.personas) {
      for (const o of p.opciones) {
        if (turnos.has(llave(o))) continue;
        const clave = await siguienteClave(cliente);
        const { rows } = await cliente.query(
          `INSERT INTO chk_turnos (clave, nombre, inicio, fin, tolerancia_min, orden, especial)
           VALUES ($1, $2, $3, $4, $5, 20 + substring($1 FROM 2)::int, true)
           RETURNING clave, nombre, to_char(inicio, 'HH24:MI') AS inicio, to_char(fin, 'HH24:MI') AS fin, especial`,
          [clave, `Especial ${o.inicio} a ${o.fin}`, o.inicio, o.fin === "24:00" ? "23:59:59" : o.fin, TOLERANCIA],
        );
        turnos.set(llave(o), rows[0]);
        creados.push(rows[0]);
      }
    }

    const { rows: carga } = await cliente.query(
      `INSERT INTO chk_horarios_cargas (archivo, personas, usuario_id) VALUES ($1, $2, $3) RETURNING id`,
      [opciones.nombreArchivo || null, r.personas.length, opciones.usuarioId || null],
    );
    const anteriores = await cliente.query("DELETE FROM chk_horarios");
    for (const p of r.personas) {
      await cliente.query(
        `INSERT INTO chk_horarios (empleado_id, nombre, area, perfil, horario_texto, turnos, carga_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          p.empleado_id,
          p.nombre,
          p.area,
          p.perfil,
          p.horario_texto,
          p.opciones.map((o) => turnos.get(llave(o)).clave),
          carga[0].id,
        ],
      );
    }
    await cliente.query("COMMIT");
    return {
      cargaId: carga[0].id,
      personas: r.personas.length,
      reemplazados: anteriores.rowCount,
      turnosCreados: creados,
      avisos: r.avisos,
    };
  } catch (e) {
    await cliente.query("ROLLBACK");
    throw e;
  } finally {
    cliente.release();
  }
}

/** La lista vigente, agrupada por turnos, y la última carga. */
async function resumen() {
  const [{ rows: grupos }, { rows: ultima }] = await Promise.all([
    db.query(
      `SELECT h.turnos, count(*)::int AS personas,
              array_agg(DISTINCT h.perfil) FILTER (WHERE h.perfil IS NOT NULL) AS perfiles,
              (SELECT json_agg(json_build_object('clave', t.clave, 'nombre', t.nombre,
                        'inicio', to_char(t.inicio, 'HH24:MI'), 'fin', to_char(t.fin, 'HH24:MI'),
                        'tolerancia', t.tolerancia_min) ORDER BY t.orden)
                 FROM chk_turnos t WHERE t.clave = ANY(h.turnos)) AS detalle
         FROM chk_horarios h
        GROUP BY h.turnos
        ORDER BY count(*) DESC`,
    ),
    db.query(
      `SELECT c.archivo, c.personas, u.nombre_completo AS usuario,
              to_char(c.creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
         FROM chk_horarios_cargas c LEFT JOIN usuarios u ON u.id = c.usuario_id
        ORDER BY c.creado_en DESC LIMIT 1`,
    ),
  ]);
  return { grupos, ultimaCarga: ultima[0] || null, personas: grupos.reduce((s, g) => s + g.personas, 0) };
}

/** Nómina → turnos contra los que se le compara. Solo quien tiene horario especial. */
async function mapaHorarios() {
  const { rows } = await db.query("SELECT empleado_id, turnos FROM chk_horarios");
  return new Map(rows.map((r) => [r.empleado_id, r.turnos]));
}

module.exports = { analizarArchivo, importarArchivo, resumen, mapaHorarios };
