const XLSX = require("xlsx");

/**
 * Lector del reporte "Transacciones" que exporta el sistema de Hikvision.
 *
 * Arriba trae un encabezado (renglones combinados) y luego la tabla:
 *
 *   Transacciones
 *   Hora de exportación: 2026-10-22 13:07
 *   Operador: admin
 *   Periodo: 2026-10-22 - 2026-10-22
 *   ID | Nombre | Apellido | Departamento | Fecha | Tiempo | Punto de control de asistencia
 *
 * Las columnas se encuentran por su encabezado, no por su letra.
 *
 * Limpieza:
 *   - Nombre + Apellido en un solo nombre.
 *   - Departamento sin el "All Departments>" del principio; se guarda la ruta y
 *     su último nivel ("PLANEACION>MRP SUPPORT>MANTENIMIENTO" → MANTENIMIENTO).
 *   - Hora a HH:MM:SS. Hikvision la da en HH:MM, sin segundos.
 *   - Renglones idénticos dentro del mismo archivo se juntan en uno.
 */

const normal = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const texto = (v) => {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** '2026-10-22', '22/10/2026' o una fecha de Excel → 'YYYY-MM-DD'. */
function fechaIso(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** '08:08', '8:08:30' o una fracción de día de Excel → 'HH:MM:SS'. */
function horaIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const seg = Math.round((v % 1) * 86400);
    const h = Math.floor(seg / 3600);
    const mi = Math.floor((seg % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(seg % 60).padStart(2, "0")}`;
  }
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}`;
}

/** "All Departments>PLANEACION>MANTENIMIENTO" → { ruta, departamento }. */
function limpiarDepartamento(v) {
  const t = texto(v);
  if (!t) return { ruta: null, departamento: null };
  const ruta = t.replace(/^all departments\s*>\s*/i, "").replace(/\s*>\s*/g, ">");
  const partes = ruta.split(">").filter(Boolean);
  return { ruta, departamento: partes[partes.length - 1] || ruta };
}

/**
 * Lee el archivo.
 *
 * @param {Buffer|String} contenido
 * @returns {Object} { filas, avisos, periodoDesde, periodoHasta, exportadoEn, leidas }
 */
function parsearTransacciones(contenido) {
  const libro = Buffer.isBuffer(contenido)
    ? XLSX.read(contenido, { type: "buffer" })
    : XLSX.readFile(contenido);
  const ws = libro.Sheets[libro.SheetNames[0]];
  const renglones = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // Encabezado del reporte (periodo y hora de exportación) y la fila de títulos
  let periodoDesde = null;
  let periodoHasta = null;
  let exportadoEn = null;
  let filaTitulos = -1;
  for (let i = 0; i < Math.min(renglones.length, 30) && filaTitulos < 0; i++) {
    const celdas = renglones[i].map(normal);
    const primera = texto(renglones[i][0]) || "";
    let m = primera.match(/periodo:\s*(\S+)\s*-\s*(\S+)/i);
    if (m) {
      periodoDesde = fechaIso(m[1]);
      periodoHasta = fechaIso(m[2]);
    }
    m = primera.match(/exportaci[oó]n:\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/i);
    if (m) exportadoEn = `${m[1]} ${horaIso(m[2])}`;
    if (celdas.includes("id") && celdas.some((c) => c.startsWith("nombre"))) filaTitulos = i;
  }
  if (filaTitulos < 0) {
    throw new Error(
      'No parece el reporte de Transacciones de Hikvision: no se encontró la fila de títulos (ID, Nombre, …).',
    );
  }

  const titulos = renglones[filaTitulos].map(normal);
  const col = (re) => titulos.findIndex((t) => re.test(t));
  const c = {
    id: col(/^id$/),
    nombre: col(/^nombre/),
    apellido: col(/^apellido/),
    departamento: col(/^departamento/),
    fecha: col(/^fecha/),
    hora: col(/^(tiempo|hora)/),
    punto: col(/punto de control|dispositivo|lector/),
  };
  const faltan = ["id", "fecha", "hora"].filter((k) => c[k] < 0);
  if (faltan.length) {
    throw new Error(`Al reporte le falta la columna: ${faltan.join(", ")}.`);
  }

  const filas = [];
  const vistas = new Set();
  const avisos = [];
  let invalidas = 0;
  let repetidas = 0;
  let leidas = 0;

  for (let i = filaTitulos + 1; i < renglones.length; i++) {
    const r = renglones[i];
    const id = texto(r[c.id]);
    if (!id) continue;
    leidas++;
    const fecha = fechaIso(r[c.fecha]);
    const hora = horaIso(r[c.hora]);
    if (!fecha || !hora) {
      invalidas++;
      continue;
    }
    const punto = c.punto >= 0 ? texto(r[c.punto]) || "" : "";
    const llave = `${id}|${fecha}|${hora}|${punto}`;
    if (vistas.has(llave)) {
      repetidas++;
      continue;
    }
    vistas.add(llave);

    const dep = limpiarDepartamento(c.departamento >= 0 ? r[c.departamento] : null);
    const nombre = [c.nombre >= 0 ? texto(r[c.nombre]) : null, c.apellido >= 0 ? texto(r[c.apellido]) : null]
      .filter(Boolean)
      .join(" ");
    filas.push({
      empleado_id: id.replace(/^0+(?=\d)/, ""),
      nombre: nombre || null,
      departamento: dep.departamento,
      departamento_ruta: dep.ruta,
      fecha,
      hora,
      punto,
    });
  }

  if (invalidas) avisos.push(`${invalidas} renglones sin fecha u hora válida no se cargaron.`);
  if (repetidas) avisos.push(`${repetidas} renglones venían repetidos idénticos en el archivo.`);
  if (!periodoDesde && filas.length) {
    const fechas = filas.map((f) => f.fecha).sort();
    periodoDesde = fechas[0];
    periodoHasta = fechas[fechas.length - 1];
  }

  return { filas, avisos, periodoDesde, periodoHasta, exportadoEn, leidas };
}

module.exports = { parsearTransacciones, horaIso, fechaIso, limpiarDepartamento };
