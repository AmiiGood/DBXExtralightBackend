const XLSX = require("xlsx");

/**
 * Lector del libro de horarios especiales de RH ("horarios compuesto y admon").
 *
 *   NÓMINA | NOMBRE | INGRESO | ÁREA | TURNO | STATUS | (horario) | PERFIL
 *
 * La columna del horario NO tiene título: se reconoce porque trae textos como
 * "8:30 am a 6:00 pm". Puede traer dos opciones separadas por "o"
 * ("7:00 am a 7:00 pm o 7:00 pm a 7:00 am") para quien rola entre día y noche.
 *
 * El PERFIL afina eso: "MATUTINO" se queda con la opción de la mañana y
 * "NOCTURNO" con la de la noche; los "ROL" se quedan con las dos y el reporte
 * decide por la hora en que entraron.
 *
 * La columna TURNO (A/C) no se usa: no coincide con el perfil (hay matutinos con
 * C) y parece ser el turno que les tiene FORTIA.
 *
 * Solo se toma a quien tiene STATUS ACTIVO (o no trae la columna).
 */

const normal = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const texto = (v) => {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

const HORARIO = /\d{1,2}(:\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?|hrs?)?\s+a\s+\d{1,2}/i;

/** "8:30 am", "6:00 pm", "19:00", "7 pm" → "HH:MM", o null. */
function horaDe(s) {
  const m = String(s)
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|hrs?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const sufijo = (m[3] || "").replace(/[^ap]/g, "");
  if (sufijo === "p" && h < 12) h += 12;
  if (sufijo === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** "8:30 am a 6:00 pm o 7:00 pm a 7:00 am" → [{ inicio, fin }, …], o null si no se entiende. */
function leerHorario(s) {
  const t = texto(s);
  if (!t) return null;
  const opciones = t.split(/\s+o\s+/i).map((op) => {
    const partes = op.split(/\s+a\s+/i);
    if (partes.length !== 2) return null;
    const inicio = horaDe(partes[0]);
    const fin = horaDe(partes[1]);
    return inicio && fin && inicio !== fin ? { inicio, fin } : null;
  });
  return opciones.length && opciones.every(Boolean) ? opciones : null;
}

/** Con el perfil, cuáles opciones aplican. */
function filtrarPorPerfil(opciones, perfil) {
  const p = normal(perfil);
  const deManana = (o) => o.inicio < "12:00";
  if (/matutino|dia\b|diurno/.test(p)) return opciones.filter(deManana);
  if (/nocturno|noche/.test(p)) return opciones.filter((o) => !deManana(o));
  return opciones;
}

/**
 * Lee el libro.
 *
 * @param {Buffer|String} contenido
 * @returns {Object} { hoja, personas, avisos, leidas }
 *   personas: [{ renglon, empleado_id, nombre, area, perfil, horario_texto, opciones: [{ inicio, fin }] }]
 */
function parsearHorarios(contenido) {
  const libro = Buffer.isBuffer(contenido) ? XLSX.read(contenido, { type: "buffer" }) : XLSX.readFile(contenido);

  for (const hoja of libro.SheetNames) {
    const renglones = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: true, defval: null });

    let fila = -1;
    let titulos = [];
    for (let i = 0; i < Math.min(renglones.length, 15); i++) {
      titulos = (renglones[i] || []).map(normal);
      if (titulos.some((t) => /^n(o|u)mina/.test(t)) && titulos.some((t) => t.startsWith("nombre"))) {
        fila = i;
        break;
      }
    }
    if (fila < 0) continue;

    const col = (re) => titulos.findIndex((t) => re.test(t));
    const c = {
      nomina: col(/^n(o|u)mina/),
      nombre: col(/^nombre/),
      area: col(/^area/),
      estado: col(/^(status|estatus|estado)/),
      perfil: col(/^perfil/),
      horario: col(/^horario/),
    };
    // Sin título: la columna donde más renglones parecen un horario
    if (c.horario < 0) {
      const cuenta = {};
      for (const r of renglones.slice(fila + 1)) {
        (r || []).forEach((v, k) => {
          if (typeof v === "string" && HORARIO.test(v)) cuenta[k] = (cuenta[k] || 0) + 1;
        });
      }
      const mejor = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
      if (mejor) c.horario = Number(mejor[0]);
    }
    if (c.horario < 0) {
      throw new Error('No se encontró la columna del horario (textos como "8:30 am a 6:00 pm").');
    }

    const personas = [];
    const avisos = [];
    const inactivos = [];
    const sinHorario = [];
    const vistos = new Set();
    let leidas = 0;

    for (let i = fila + 1; i < renglones.length; i++) {
      const r = renglones[i] || [];
      const nomina = texto(r[c.nomina]);
      if (!nomina || !/^\d+$/.test(nomina)) continue;
      leidas++;
      const empleado = nomina.replace(/^0+(?=\d)/, "");
      const estado = c.estado >= 0 ? normal(r[c.estado]) : "activo";
      if (estado && estado !== "activo") {
        inactivos.push(empleado);
        continue;
      }
      const horarioTexto = texto(r[c.horario]);
      const perfil = c.perfil >= 0 ? texto(r[c.perfil]) : null;
      const todas = leerHorario(horarioTexto);
      if (!todas) {
        sinHorario.push(`renglón ${i + 1} (${empleado}): "${horarioTexto || "vacío"}"`);
        continue;
      }
      let opciones = filtrarPorPerfil(todas, perfil);
      if (opciones.length === 0) {
        avisos.push(`El perfil "${perfil}" de la nómina ${empleado} no coincide con su horario; se usan todas sus opciones.`);
        opciones = todas;
      }
      if (vistos.has(empleado)) {
        avisos.push(`La nómina ${empleado} viene más de una vez; se usa el último renglón.`);
        const k = personas.findIndex((p) => p.empleado_id === empleado);
        personas.splice(k, 1);
      }
      vistos.add(empleado);
      personas.push({
        renglon: i + 1,
        empleado_id: empleado,
        nombre: c.nombre >= 0 ? texto(r[c.nombre]) : null,
        area: c.area >= 0 ? texto(r[c.area]) : null,
        perfil,
        horario_texto: horarioTexto,
        opciones,
      });
    }

    if (inactivos.length) avisos.push(`${inactivos.length} personas sin STATUS ACTIVO no se cargaron.`);
    if (sinHorario.length) avisos.push(`No se entendió el horario de: ${sinHorario.join("; ")}.`);
    return { hoja, personas, avisos, leidas };
  }

  throw new Error("No se encontró una hoja con las columnas NÓMINA y NOMBRE.");
}

module.exports = { parsearHorarios, leerHorario, horaDe, filtrarPorPerfil };
