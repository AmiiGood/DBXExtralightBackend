const XLSX = require("xlsx");

/**
 * Parser del Excel de la junta de STAFF ('2026 CPC JUNTA DE STAFF WEEK NN.xlsx').
 *
 * Es un archivo distinto a todos los demás del proyecto: no es una lista de
 * renglones, es una MATRIZ HORIZONTAL que crece una columna por semana. Los
 * periodos van en los encabezados y las métricas en los renglones.
 *
 * Cada bloque trae su PROPIO renglón de encabezados repetido a lo ancho, así
 * que no hay un solo renglón de periodos para toda la hoja:
 *
 *   'Data Tracking'  fila 45  4.-INJECTION      métricas en las filas 46-51
 *                    fila 54  5.- ASSY                          55-60
 *                    fila 77  8.- ROTACION SEMANAL              78-88
 *   'Compras'        fila 2   7. OPEN PO                          3-14
 *                    fila 16  3.  INVOICE                        17-23
 *
 * Los bloques se buscan por su etiqueta y no por número de fila: el archivo se
 * edita a mano cada semana y alguien va a insertar un renglón tarde o temprano.
 *
 * ---------------------------------------------------------------------------
 * EL PROBLEMA DE FONDO: los encabezados no dicen de qué año son
 * ---------------------------------------------------------------------------
 * Conviven media docena de formas de escribir un periodo, en dos idiomas, y
 * las columnas recientes perdieron el año por completo:
 *
 *   'WEEK 40'  'Week 40'  40  '49-1'  '40A'      <- semanas
 *   'AUG'  'JAN 22'  'OCT 2022'  'Mar-22'        <- meses con y sin año
 *   'AGOSTO 2025'  'OCTUBRE'  'JANUARY'  'JULY'  <- ... y en dos idiomas
 *   '2023'  '2024'  '2025'                       <- totales del año, NO periodos
 *
 * Se resuelve recorriendo las columnas de izquierda a derecha con un año en
 * curso: cuando la etiqueta trae año se toma ese y se corrige el acumulado
 * (así un error nunca se arrastra más allá del siguiente ancla), y cuando no
 * lo trae se usa el año en curso, subiéndolo si el mes o la semana RETROCEDE
 * respecto al anterior, que es justo lo que pasa al cambiar de año.
 */

// =============================================
// NORMALIZACIÓN
// =============================================

/** Espacios duros y de más. El archivo está lleno: se arma copiando y pegando. */
const limpiar = (v) =>
  v === null || v === undefined
    ? null
    : String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim() || null;

/** Clave para comparar etiquetas de renglón: sin acentos, sin espacios, en mayúsculas. */
const clave = (v) => {
  const t = limpiar(v);
  return t
    ? t
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
    : null;
};

/**
 * Número tolerante.
 *
 * Acepta el porcentaje escrito como texto ('4,14%'), que aparece suelto en la
 * fila de antigüedad, y lo devuelve como fracción para que empate con las
 * demás celdas del mismo renglón, que sí vienen como 0.0414.
 */
function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const t = String(v).replace(/ /g, " ").trim();
  if (!t) return null;

  const esPct = t.endsWith("%");
  // La coma es decimal en '4,14%' y separador de miles en '1,390,370'
  const cuerpo = esPct ? t.slice(0, -1).replace(",", ".") : t.replace(/,/g, "");
  const n = parseFloat(cuerpo.replace(/\s/g, ""));
  if (!Number.isFinite(n)) return null;
  return esPct ? n / 100 : n;
}

// =============================================
// PERIODOS
// =============================================

/**
 * Meses en los tres idiomas en que aparecen en el archivo: español completo y
 * abreviado, e inglés. Se indexan por la clave normalizada.
 */
const MESES = {
  ENERO: 1, ENE: 1, JANUARY: 1, JAN: 1,
  FEBRERO: 2, FEB: 2, FEBRUARY: 2,
  MARZO: 3, MAR: 3, MARCH: 3,
  ABRIL: 4, ABR: 4, APRIL: 4, APR: 4,
  MAYO: 5, MAY: 5,
  JUNIO: 6, JUN: 6, JUNE: 6,
  JULIO: 7, JUL: 7, JULY: 7,
  AGOSTO: 8, AGO: 8, AUGUST: 8, AUG: 8,
  SEPTIEMBRE: 9, SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OCTUBRE: 10, OCT: 10, OCTOBER: 10,
  NOVIEMBRE: 11, NOV: 11, NOVEMBER: 11,
  DICIEMBRE: 12, DIC: 12, DECEMBER: 12, DEC: 12,
};

const NOMBRE_MES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Etiquetas que NO son un periodo y hay que saltarse sin avisar. */
const NO_PERIODO = new Set([
  "TOTAL", "BACKLOG", "UNCOMMITED", "UNCOMMITTED", "PRODOTTO", "UMEDIDA", "BU",
]);

/**
 * Interpreta una etiqueta de columna.
 *
 * @returns {null | {tipo, numero, anio}}  anio = null cuando la etiqueta no lo
 *   trae y hay que deducirlo de la secuencia.
 */
function leerEtiqueta(valor) {
  // Una fecha real: en la columna de enero 2022 alguien escribió 01/01/2022 y
  // Excel la guardó como fecha en vez de como texto.
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return { tipo: "MES", numero: valor.getMonth() + 1, anio: valor.getFullYear() };
  }

  const texto = limpiar(valor);
  if (texto === null) return null;

  const k = clave(texto);
  if (!k || NO_PERIODO.has(k)) return null;

  // Semana escrita como número pelón: en Invoice las columnas semanales son
  // 45, 46, 47... y las variantes '49-1' / '23_1' / '40A' que alguien usó para
  // desempatar una semana partida entre dos meses. Se quedan con el número.
  const soloNumero = texto.match(/^(\d{1,2})(?:\s*[-_]\s*\d+|[A-Za-z])?$/);
  if (soloNumero) {
    const n = Number(soloNumero[1]);
    return n >= 1 && n <= 53 ? { tipo: "SEMANA", numero: n, anio: null } : null;
  }

  // Un año pelón ('2023', '2024'): es la columna de total anual, no un periodo.
  if (/^\d{4}$/.test(texto)) return null;

  // 'WEEK 40', 'Week 40', 'WEEK 02'
  const semana = k.match(/^WEEK(\d{1,2})$/);
  if (semana) {
    const n = Number(semana[1]);
    return n >= 1 && n <= 53 ? { tipo: "SEMANA", numero: n, anio: null } : null;
  }

  // Mes con o sin año: 'AUG', 'JAN 22', 'OCT 2022', 'Mar-22', 'AGOSTO 2025'
  const mes = k.match(/^([A-Z]+)(\d{2,4})?$/);
  if (mes) {
    const m = MESES[mes[1]];
    if (!m) return null;
    let anio = null;
    if (mes[2]) {
      anio = Number(mes[2]);
      if (anio < 100) anio += 2000;
    }
    return { tipo: "MES", numero: m, anio };
  }

  return null;
}

/** Etiqueta legible y clave estable de un periodo ya resuelto. */
function describirPeriodo(p) {
  return p.tipo === "MES"
    ? {
        ...p,
        codigo: `${p.anio}-M${String(p.numero).padStart(2, "0")}`,
        etiqueta: `${NOMBRE_MES[p.numero - 1]} ${p.anio}`,
      }
    : {
        ...p,
        codigo: `${p.anio}-S${String(p.numero).padStart(2, "0")}`,
        etiqueta: `Sem ${String(p.numero).padStart(2, "0")} ${p.anio}`,
      };
}

/**
 * Resuelve los periodos de un renglón de encabezados.
 *
 * Recorre de izquierda a derecha arrastrando el año. Los meses y las semanas
 * llevan contador propio porque van intercalados y uno no dice nada del otro:
 * entre 'WEEK 31' y 'WEEK 32' se cuela 'JULY', y eso no es un retroceso.
 *
 * @param {Array}  fila       renglón de encabezados, como matriz de celdas
 * @param {Number} desde      primera columna a leer
 * @param {Number} anioInicio año de la primera columna con datos
 * @returns {{porColumna: Map<Number, Object>, avisos: Array}}
 */
function resolverPeriodos(fila, desde, anioInicio) {
  const porColumna = new Map();
  const avisos = [];

  let anio = anioInicio;
  let ultimoMes = null;
  let ultimaSemana = null;
  let desfases = 0;

  for (let c = desde; c < fila.length; c++) {
    const leido = leerEtiqueta(fila[c]);
    if (!leido) continue;

    const anioPrevio = anio;

    if (leido.anio !== null) {
      // Ancla: la etiqueta dice el año. Manda sobre lo acumulado, y de paso
      // corta el arrastre de cualquier error anterior.
      if (leido.anio !== anio) {
        if (leido.anio < anio) desfases++;
        anio = leido.anio;
      }
    } else if (leido.tipo === "MES") {
      if (ultimoMes !== null && leido.numero < ultimoMes) anio++;
    } else if (ultimaSemana !== null && leido.numero < ultimaSemana) {
      // Una semana que retrocede es cambio de año... salvo los saltos de una
      // o dos semanas hacia atrás, que son correcciones de captura sueltas
      // ('WEEK 45' después de 'WEEK 46'). Solo un retroceso grande cuenta.
      if (ultimaSemana - leido.numero > 10) anio++;
      else desfases++;
    }

    // Al cambiar de año se olvidan los dos contadores. Si no, el que no
    // disparó el cambio vuelve a dispararlo: las semanas pasan a 2026 en
    // 'WEEK 01' y, unas columnas después, 'JANUARY' se veía como retroceso
    // frente a 'NOVIEMBRE' y subía el año una segunda vez.
    if (anio !== anioPrevio) {
      ultimoMes = null;
      ultimaSemana = null;
    }

    if (leido.tipo === "MES") ultimoMes = leido.numero;
    else ultimaSemana = leido.numero;

    porColumna.set(
      c,
      describirPeriodo({ tipo: leido.tipo, numero: leido.numero, anio }),
    );
  }

  if (desfases) {
    avisos.push(
      `${desfases} encabezados de periodo fuera de secuencia. Se respetó el año ` +
        "que trae la etiqueta; revisar si alguna columna quedó mal fechada.",
    );
  }

  return { porColumna, avisos };
}

// =============================================
// LECTURA DE LAS HOJAS
// =============================================

const HOJA_TRACKING = "Data Tracking";
const HOJA_COMPRAS = "Compras";

/**
 * Abre una hoja como matriz de arreglos con ÍNDICES ABSOLUTOS.
 *
 * Por omisión SheetJS recorta la matriz al rango usado, así que una hoja que
 * arranca en B2 devuelve la columna B en el índice 0. 'Compras' es justo así y
 * eso corría todas las columnas un lugar. Se fuerza el rango a empezar en A1
 * para que el índice 0 sea siempre la columna A y las posiciones documentadas
 * aquí (C, D, E...) signifiquen lo mismo en las dos hojas.
 */
function leerHoja(libro, nombreHoja) {
  const hoja = libro.Sheets[nombreHoja];
  if (!hoja) {
    throw new Error(
      `El archivo no tiene la hoja "${nombreHoja}". Trae: ${libro.SheetNames.join(", ")}`,
    );
  }
  const rango = XLSX.utils.decode_range(hoja["!ref"] || "A1");
  rango.s.c = 0;
  rango.s.r = 0;
  return XLSX.utils.sheet_to_json(hoja, {
    header: 1,
    raw: true,
    defval: null,
    range: XLSX.utils.encode_range(rango),
  });
}

function abrirLibro(archivo) {
  return XLSX.read(
    typeof archivo === "string" ? require("fs").readFileSync(archivo) : archivo,
    { type: "buffer", cellDates: true, dense: true },
  );
}

/**
 * Busca el renglón de encabezados de un bloque por su etiqueta.
 *
 * @param {Number} col  columna donde vive el título del bloque (3 en Data
 *                      Tracking, 2 en Compras)
 */
function buscarBloque(matriz, col, patron) {
  for (let r = 0; r < matriz.length; r++) {
    const k = clave(matriz[r]?.[col]);
    if (k && patron.test(k)) return r;
  }
  return -1;
}

/**
 * Lee un bloque: encabezados en `filaEncabezado`, métricas en los renglones
 * siguientes, emparejadas por su etiqueta.
 *
 * Un mismo periodo puede caer en DOS columnas del mismo renglón. Pasa solo en
 * Invoice, donde una semana partida entre dos meses se captura en dos pedazos
 * ('49' bajo Noviembre y '49-1' bajo Diciembre) para que los dos totales
 * mensuales cuadren. Ahí los pedazos se SUMAN: la semana 49 de 2021 son 49,944
 * pares facturados en noviembre más 101,844 en diciembre, y sumados dejan
 * intactos los totales de los dos meses.
 *
 * En los bloques de promedio diario (Inyección, Ensamble, Rotación) sumar
 * sería un disparate, así que ahí un periodo repetido se queda con el último
 * valor y se avisa. Hoy no ocurre en ninguno.
 *
 * @param {Object} metricas   { CLAVENORMALIZADA: 'codigo_metrica' }
 * @param {Number} alcance    cuántos renglones mirar hacia abajo
 * @param {String} agregacion 'SUMA' | 'UNICO'
 */
function leerBloque(
  matriz, filaEncabezado, colEtiqueta, primeraCol, anioInicio, metricas, alcance, agregacion,
) {
  const { porColumna, avisos } = resolverPeriodos(
    matriz[filaEncabezado] || [],
    primeraCol,
    anioInicio,
  );

  const acumulado = new Map();
  const encontradas = new Set();
  let repetidos = 0;

  for (let r = filaEncabezado + 1; r <= filaEncabezado + alcance && r < matriz.length; r++) {
    const fila = matriz[r];
    if (!fila) continue;
    const codigo = metricas[clave(fila[colEtiqueta])];
    if (!codigo || encontradas.has(codigo)) continue;
    encontradas.add(codigo);

    for (const [c, periodo] of porColumna) {
      const v = numero(fila[c]);
      if (v === null) continue;

      const llave = `${periodo.codigo}|${codigo}`;
      const previo = acumulado.get(llave);
      if (previo) {
        repetidos++;
        previo.valor = agregacion === "SUMA" ? previo.valor + v : v;
        continue;
      }
      acumulado.set(llave, {
        periodo_codigo: periodo.codigo,
        periodo_tipo: periodo.tipo,
        anio: periodo.anio,
        numero: periodo.numero,
        etiqueta: periodo.etiqueta,
        metrica_codigo: codigo,
        valor: v,
      });
    }
  }

  if (repetidos && agregacion !== "SUMA") {
    avisos.push(
      `${repetidos} celdas cayeron en un periodo que ya tenía valor. Se dejó el ` +
        "último; revisar si hay dos columnas con el mismo encabezado.",
    );
  }

  const faltantes = Object.values(metricas).filter((m) => !encontradas.has(m));
  if (faltantes.length) {
    avisos.push(
      `No se encontraron los renglones de: ${faltantes.join(", ")}. ` +
        "Esas series no se van a actualizar.",
    );
  }

  return { valores: [...acumulado.values()], avisos };
}

// =============================================
// BLOQUES
// =============================================

/**
 * Métricas por bloque. La llave es la etiqueta del renglón ya normalizada
 * (sin acentos ni espacios) y el valor es el código con el que vive en la base.
 *
 * Producción e Inyección repiten las mismas tres etiquetas de meta, por eso
 * cada bloque tiene su propio mapa y se lee acotado a sus renglones.
 */
const METRICAS_INYECCION = {
  GOALCROCSPRS: "inj_crocs_meta",
  GOALSUOLEPRS: "inj_suela_meta",
  GOALPILLOWPCS: "inj_almohada_meta",
  INJECTIONCROCS: "inj_crocs",
  INJECTIONSUOLE: "inj_suela",
  INJECTIONPILLOW: "inj_almohada",
};

const METRICAS_ENSAMBLE = {
  GOALCROCSPRS: "assy_crocs_meta",
  GOALSUOLEPRS: "assy_suela_meta",
  GOALPILLOWPCS: "assy_almohada_meta",
  ASSEMBLYCROCS: "assy_crocs",
  ASSEMBLYSUOLE: "assy_suela",
  ASSEMBLYPILLOW: "assy_almohada",
};

const METRICAS_ROTACION = {
  PLANTILLA: "rot_plantilla",
  GOALTOTALPLANTILLA: "rot_plantilla_meta",
  BAJAS: "rot_bajas",
  PORCENTAJEDEBAJAS: "rot_pct_bajas",
  PORCENTAJEDEAUSENTISMO: "rot_pct_ausentismo",
  "2SEMANASDEANTIGUEDAD": "rot_pct_antiguedad",
  METAVARIANTESDEAUSENTISMO: "rot_variantes_meta",
  VARIANTESDEAUSENTISMO: "rot_variantes",
  ADMINISTRACION: "rot_administracion",
  BUDGET: "rot_budget",
  TOTALFOAM: "rot_total_foam",
};

const METRICAS_INVOICE = {
  CROCS: "inv_crocs",
  FOAMCANADA: "inv_foam_canada",
  SOLE: "inv_sole",
  DUALCOLOR: "inv_dual_color",
  CROCSGOAL: "inv_crocs_meta",
  FOAMCANADAGOAL: "inv_foam_canada_meta",
  SOLEGOAL: "inv_sole_meta",
};

/**
 * Año de la primera columna con datos de cada bloque.
 *
 * El archivo arranca en 2021 y nunca lo dice: la primera etiqueta de Invoice
 * es ' enero' y la de Injection es 'WEEK 40', las dos sin año. Se ancla aquí y
 * la primera etiqueta que sí traiga año (ene-2022 en los dos bloques) lo
 * confirma o lo corrige sin que nadie tenga que tocar esta constante.
 */
const ANIO_INICIO = 2021;

/** Columna donde arrancan los datos: después de las etiquetas de renglón. */
const PRIMERA_COL_TRACKING = 4; // E
const PRIMERA_COL_COMPRAS = 3; // D

// =============================================
// SERIES (Invoice, Inyección, Ensamble, Rotación)
// =============================================

/**
 * Lee los cuatro bloques de serie temporal.
 *
 * @param {String|Buffer} archivo
 * @returns {{valores: Array, periodos: Array, avisos: Array}}
 */
function parsearSeries(archivo) {
  const libro = abrirLibro(archivo);
  const tracking = leerHoja(libro, HOJA_TRACKING);
  const compras = leerHoja(libro, HOJA_COMPRAS);

  const avisos = [];
  const valores = [];

  const bloques = [
    { matriz: tracking, col: 3, primera: PRIMERA_COL_TRACKING, patron: /INJECTION$/, metricas: METRICAS_INYECCION, alcance: 8, agregacion: "UNICO", nombre: "Inyección" },
    { matriz: tracking, col: 3, primera: PRIMERA_COL_TRACKING, patron: /ASSY$/, metricas: METRICAS_ENSAMBLE, alcance: 8, agregacion: "UNICO", nombre: "Ensamble" },
    { matriz: tracking, col: 3, primera: PRIMERA_COL_TRACKING, patron: /ROTACIONSEMANAL$/, metricas: METRICAS_ROTACION, alcance: 14, agregacion: "UNICO", nombre: "Rotación" },
    { matriz: compras, col: 2, primera: PRIMERA_COL_COMPRAS, patron: /^3INVOICE$/, metricas: METRICAS_INVOICE, alcance: 10, agregacion: "SUMA", nombre: "Invoice" },
  ];

  for (const b of bloques) {
    const fila = buscarBloque(b.matriz, b.col, b.patron);
    if (fila < 0) {
      avisos.push(`No se encontró el bloque de ${b.nombre} en el archivo.`);
      continue;
    }
    const r = leerBloque(
      b.matriz, fila, b.col, b.primera, ANIO_INICIO, b.metricas, b.alcance, b.agregacion,
    );
    valores.push(...r.valores);
    avisos.push(...r.avisos.map((a) => `${b.nombre}: ${a}`));
  }

  // Un catálogo de periodos sin repetir, para darlos de alta antes que nada
  const periodos = new Map();
  for (const v of valores) {
    if (!periodos.has(v.periodo_codigo)) {
      periodos.set(v.periodo_codigo, {
        codigo: v.periodo_codigo,
        tipo: v.periodo_tipo,
        anio: v.anio,
        numero: v.numero,
        etiqueta: v.etiqueta,
      });
    }
  }

  return { valores, periodos: [...periodos.values()], avisos };
}

// =============================================
// OPEN PO
// =============================================

/**
 * Los renglones del bloque de PO abierta, con su BU y si son meta.
 *
 * 'Total Crocs'..'Total Dual Color' no se leen: son la suma de la propia fila,
 * ya viene en la columna Total y guardarla dos veces solo da oportunidad de
 * que no cuadren.
 */
const METRICAS_OPEN_PO = {
  OPENPOSCROCS: { bu: "CROCS", meta: false },
  OPENPOSCROCSGOAL: { bu: "CROCS", meta: true },
  OPENPOSFOAMCANADA: { bu: "FOAM CANADA", meta: false },
  OPENPOSFOAMCANADAGOAL: { bu: "FOAM CANADA", meta: true },
  OPENPOSSOLE: { bu: "SOLE", meta: false },
  OPENPOSSOLEGOAL: { bu: "SOLE", meta: true },
  OPENPOSDUALCOLOR: { bu: "DUAL COLOR", meta: false },
  OPENPOSDUALCOLORGOAL: { bu: "DUAL COLOR", meta: true },
};

/**
 * Lee el bloque de Open PO.
 *
 * Es lo único del archivo que NO es una serie temporal: es la foto de la
 * cartera al momento del corte, y el Excel la sobreescribe cada semana. Por eso
 * se guarda con la semana de corte y sus columnas se quedan como texto
 * ('BACKLOG', 'Agosto', 'UNCOMMITED') en vez de convertirse a periodo: son
 * meses de ENTREGA futura, no periodos de captura, y 'Backlog' y 'Uncommited'
 * ni siquiera son fechas.
 *
 * La columna 'Total' se salta: es la suma de la fila y se recalcula al leer.
 */
function parsearOpenPo(archivo) {
  const libro = abrirLibro(archivo);
  const compras = leerHoja(libro, HOJA_COMPRAS);

  const filaEnc = buscarBloque(compras, 2, /^7OPENPO$/);
  if (filaEnc < 0) {
    return { filas: [], avisos: ["No se encontró el bloque de Open PO en el archivo."] };
  }

  const encabezados = compras[filaEnc] || [];
  const columnas = [];
  for (let c = 0; c < encabezados.length; c++) {
    const texto = limpiar(encabezados[c]);
    if (!texto) continue;
    const k = clave(texto);
    if (k === "TOTAL" || k === "7OPENPO") continue;
    columnas.push({ col: c, entrega: texto.toUpperCase(), orden: columnas.length });
  }

  const filas = [];
  const avisos = [];
  const vistas = new Set();

  for (let r = filaEnc + 1; r <= filaEnc + 14 && r < compras.length; r++) {
    const fila = compras[r];
    if (!fila) continue;
    const def = METRICAS_OPEN_PO[clave(fila[2])];
    if (!def || vistas.has(clave(fila[2]))) continue;
    vistas.add(clave(fila[2]));

    for (const { col, entrega, orden } of columnas) {
      const v = numero(fila[col]);
      if (v === null) continue;
      filas.push({ bu: def.bu, meta: def.meta, entrega, orden, cantidad: v });
    }
  }

  if (!filas.length) avisos.push("El bloque de Open PO no trae ninguna cantidad.");

  return { filas, avisos };
}

// =============================================
// SEMANA DE CORTE
// =============================================

/**
 * Semana de corte del archivo, sacada del nombre ('... WEEK 35.xlsx').
 *
 * Es el único lugar donde está: por dentro el archivo no dice a qué semana
 * corresponde la foto de Open PO. Si el nombre no la trae se devuelve null y
 * quien llama decide (la pantalla de carga la pide a mano).
 */
function leerSemanaDelNombre(nombreArchivo) {
  if (!nombreArchivo) return null;
  const m = String(nombreArchivo).match(/WEEK\s*(\d{1,2})/i);
  if (!m) return null;
  const semana = Number(m[1]);
  if (semana < 1 || semana > 53) return null;

  const anioM = String(nombreArchivo).match(/(20\d{2})/);
  return { semana, anio: anioM ? Number(anioM[1]) : new Date().getFullYear() };
}

module.exports = {
  parsearSeries,
  parsearOpenPo,
  leerSemanaDelNombre,
  leerEtiqueta,
  resolverPeriodos,
  numero,
  HOJA_TRACKING,
  HOJA_COMPRAS,
};
