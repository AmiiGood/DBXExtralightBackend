const XLSX = require("xlsx");

/**
 * Parser de los Excel de Compound.
 *
 * Dos archivos, dos formas:
 *   'Producción Diaria 2025 rev01.xlsx', hoja "Producción compuestos"
 *   'Powder recovery.xlsx',              hoja "Powder recovery"
 *
 * Lo que hay que limpiar del histórico (medido sobre las 1,926 filas):
 *
 *   - 464 renglones sin turno: 213 vacíos y 251 con un espacio duro (U+00A0)
 *     que a simple vista parece un turno capturado. Los dos casos van a NULL.
 *   - Supervisores escritos de dos formas: "RICARDO" (193) y "RICARDO ESTRADA"
 *     (171) son la misma persona, igual "AGUSTIN" (462) y "AGUSTIN GUTIERREZ"
 *     (130). Sin unificarlos, cualquier corte por supervisor sale partido.
 *   - Fechas que llegan como texto en algunas hojas ("29/12/25").
 *   - Cinco columnas basura al final ("Columna1".."Columna5"), siempre vacías.
 */

/** Espacios duros y de más. Excel los mete al copiar y pegar. */
const limpiar = (v) =>
  v === null || v === undefined
    ? null
    : String(v).replace(/ /g, " ").trim() || null;

/**
 * Unifica los nombres de supervisor.
 *
 * Se comparan por la PRIMERA palabra: en el histórico nadie comparte nombre de
 * pila, así que alcanza y evita mantener una lista de alias a mano. Se guarda
 * la versión más larga vista, que es la que trae apellido.
 */
function crearNormalizadorSupervisores(filas, columna) {
  const porNombre = new Map();
  for (const f of filas) {
    const v = limpiar(f[columna]);
    if (!v) continue;
    const clave = v.toUpperCase().split(/\s+/)[0];
    const actual = porNombre.get(clave);
    if (!actual || v.length > actual.length) porNombre.set(clave, v.toUpperCase());
  }
  return (valor) => {
    const v = limpiar(valor);
    if (!v) return null;
    return porNombre.get(v.toUpperCase().split(/\s+/)[0]) || v.toUpperCase();
  };
}

/** Turno: solo A o B; cualquier otra cosa es captura faltante. */
function normalizarTurno(v) {
  const t = limpiar(v);
  if (!t) return null;
  const u = t.toUpperCase();
  return u === "A" || u === "B" ? u : null;
}

/** Número tolerante: acepta texto con comas y devuelve 0 si no hay nada. */
function numero(v, porDefecto = 0) {
  if (v === null || v === undefined || v === "") return porDefecto;
  if (typeof v === "number") return Number.isFinite(v) ? v : porDefecto;
  const n = parseFloat(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : porDefecto;
}

/** Igual que `numero` pero deja NULL cuando la celda viene vacía. */
function numeroONulo(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = numero(v, NaN);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fecha a 'AAAA-MM-DD'.
 *
 * Acepta el Date que arma SheetJS, el serial de Excel, y el texto dd/mm/aa que
 * aparece en algunas hojas. Se arma con los componentes locales y no con
 * toISOString(), que recorrería un día hacia atrás.
 */
function normalizarFecha(v) {
  if (v === null || v === undefined || v === "") return null;

  const aTexto = (d) => {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
    const dd = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}`;
  };

  if (v instanceof Date) return aTexto(v);

  if (typeof v === "number") {
    // Serial de Excel: día 1 = 1900-01-01, con el bug del año bisiesto de 1900
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return aTexto(new Date(ms + new Date().getTimezoneOffset() * 60000));
  }

  const t = String(v).trim();
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mes, anio] = m;
    anio = Number(anio);
    if (anio < 100) anio += 2000;
    return `${anio}-${String(Number(mes)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : aTexto(d);
}

/** Abre una hoja como matriz de arreglos. */
function leerHoja(archivo, nombreHoja) {
  const libro = XLSX.read(
    typeof archivo === "string" ? require("fs").readFileSync(archivo) : archivo,
    { type: "buffer", cellDates: true, dense: true },
  );
  const hoja = libro.Sheets[nombreHoja];
  if (!hoja) {
    throw new Error(
      `El archivo no tiene la hoja "${nombreHoja}". Trae: ${libro.SheetNames.join(", ")}`,
    );
  }
  return XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
}

// =============================================
// PRODUCCIÓN DIARIA
// =============================================

const HOJA_PRODUCCION = "Producción compuestos";

/**
 * Posición de cada columna en la hoja de producción.
 *
 * Se fija por índice y no por nombre porque los encabezados traen saltos de
 * línea ("PRODUCCIÓN\n(Kg)") y espacios dobles ("META  DIARIA"), y cualquier
 * retoque en el Excel rompería el emparejamiento por texto. El importador
 * valida que la fila 1 siga teniendo los encabezados esperados.
 */
const COL = {
  fecha: 0, linea: 1, produccion: 2, supervisor: 3, turno: 4, turnoHoras: 5,
  am: 6, cc: 7, lh: 8, tmm: 9, plan: 10, ft: 11, fp: 12,
  tiempoMuerto: 13, metaKgHora: 14, metaTurno: 15, cumplimiento: 16,
  realKgHora: 17, kgVsMeta: 18, pctVsMeta: 19, observaciones: 20,
};

/** Encabezados que se esperan, ya sin saltos ni espacios de más. */
const ENCABEZADOS_ESPERADOS = [
  [COL.fecha, "FECHA"],
  [COL.linea, "LINEA"],
  [COL.produccion, "PRODUCCIÓN (KG)"],
  [COL.turnoHoras, "TURNO (HR)"],
  [COL.tiempoMuerto, "TIEMPO MUERTO"],
];

function validarEncabezados(fila) {
  const normal = (v) => String(v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const malas = ENCABEZADOS_ESPERADOS.filter(
    ([i, esperado]) => normal(fila[i]) !== esperado,
  );
  if (malas.length) {
    throw new Error(
      "La hoja no tiene el formato esperado. Se esperaba " +
        malas.map(([i, e]) => `"${e}" en la columna ${i + 1}`).join(", ") +
        `. Se encontró: ${malas.map(([i]) => `"${fila[i] ?? ""}"`).join(", ")}.`,
    );
  }
}

/**
 * Lee la hoja de producción diaria.
 *
 * @param {String|Buffer} archivo
 * @returns {{filas: Array, descartadas: Number, avisos: Array}}
 */
function parsearProduccion(archivo) {
  const matriz = leerHoja(archivo, HOJA_PRODUCCION);
  if (matriz.length < 2) throw new Error("La hoja de producción está vacía");
  validarEncabezados(matriz[0]);

  const cuerpo = matriz.slice(1);
  const normalizarSupervisor = crearNormalizadorSupervisores(cuerpo, COL.supervisor);

  const filas = [];
  let descartadas = 0;
  let sinTurno = 0;
  let paroMayorQueTurno = 0;

  for (const f of cuerpo) {
    const fecha = normalizarFecha(f[COL.fecha]);
    const linea = limpiar(f[COL.linea]);
    // Sin fecha o sin línea el renglón no se puede ubicar en ningún corte
    if (!fecha || !linea) {
      if (f.some((c) => c !== null && String(c).trim() !== "")) descartadas++;
      continue;
    }

    const turno = normalizarTurno(f[COL.turno]);
    if (!turno) sinTurno++;

    const paro = {
      am: numero(f[COL.am]), cc: numero(f[COL.cc]), lh: numero(f[COL.lh]),
      tmm: numero(f[COL.tmm]), plan: numero(f[COL.plan]),
      ft: numero(f[COL.ft]), fp: numero(f[COL.fp]),
    };
    const totalParo = Object.values(paro).reduce((a, b) => a + b, 0);
    const turnoHoras = numero(f[COL.turnoHoras]);
    if (totalParo > turnoHoras) paroMayorQueTurno++;

    filas.push({
      fecha,
      linea,
      turno,
      supervisor: normalizarSupervisor(f[COL.supervisor]),
      produccion_kg: Math.max(0, numero(f[COL.produccion])),
      turno_horas: turnoHoras,
      paro_am: paro.am, paro_cc: paro.cc, paro_lh: paro.lh, paro_tmm: paro.tmm,
      paro_plan: paro.plan, paro_ft: paro.ft, paro_fp: paro.fp,
      meta_kg_hora: numeroONulo(f[COL.metaKgHora]),
      meta_turno_kg: numeroONulo(f[COL.metaTurno]),
      // Con signo y sin recortar: la columna se llama "Kg PERDIDOS" pero es
      // produccion - meta, así que un positivo es producir DE MÁS. Aplastar
      // los 611 negativos a cero inflaba el total de 223,972 a 398,769 kg.
      kg_vs_meta: numeroONulo(f[COL.kgVsMeta]),
      observaciones: limpiar(f[COL.observaciones]),
    });
  }

  const avisos = [];
  if (sinTurno) {
    avisos.push(
      `${sinTurno} renglones sin turno (A/B). Se cargan igual, pero no aparecen ` +
        "en el corte por turno.",
    );
  }
  if (paroMayorQueTurno) {
    avisos.push(
      `${paroMayorQueTurno} renglones con más paro que horas de turno. Se cargan ` +
        "igual y el reporte los señala; revisar la captura.",
    );
  }
  if (descartadas) {
    avisos.push(`${descartadas} renglones sin fecha o sin línea, descartados.`);
  }

  return { filas, descartadas, avisos };
}

// =============================================
// RECUPERACIÓN DE POLVO
// =============================================

const HOJA_RECUPERACION = "Powder recovery";

const COL_REC = {
  fecha: 0, bu: 1, produccion: 2, polvo: 3, purga: 4, meta: 5,
};

/**
 * Lee la hoja de recuperación de polvo.
 *
 * Los porcentajes del Excel (%Reciclado, %Purga) NO se leen: son fórmulas y se
 * vuelven a calcular desde los kilos, que es lo único que se captura a mano.
 */
function parsearRecuperacion(archivo) {
  const matriz = leerHoja(archivo, HOJA_RECUPERACION);
  if (matriz.length < 2) throw new Error("La hoja de recuperación está vacía");

  const filas = [];
  let descartadas = 0;

  for (const f of matriz.slice(1)) {
    const fecha = normalizarFecha(f[COL_REC.fecha]);
    const bu = limpiar(f[COL_REC.bu]);
    if (!fecha || !bu) {
      if (f.some((c) => c !== null && String(c).trim() !== "")) descartadas++;
      continue;
    }
    filas.push({
      fecha,
      bu: bu.toUpperCase(),
      produccion_kg: Math.max(0, numero(f[COL_REC.produccion])),
      consumo_polvo_kg: Math.max(0, numero(f[COL_REC.polvo])),
      purga_kg: Math.max(0, numero(f[COL_REC.purga])),
      meta: numeroONulo(f[COL_REC.meta]),
    });
  }

  const avisos = descartadas
    ? [`${descartadas} renglones sin fecha o sin BU, descartados.`]
    : [];

  return { filas, descartadas, avisos };
}

module.exports = {
  parsearProduccion,
  parsearRecuperacion,
  normalizarFecha,
  normalizarTurno,
  HOJA_PRODUCCION,
  HOJA_RECUPERACION,
};
