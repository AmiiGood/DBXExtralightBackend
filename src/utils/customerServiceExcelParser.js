const XLSX = require("xlsx");

/**
 * Parser de los dos libros de Customer Service.
 *
 *   'KPI Customer Service AAAA.xlsx'  hojas OTS, SC y OTIF
 *   'Muestras AAAA.xlsx'              hoja 'Timeline Samples'
 *
 * Los dos son AGRADABLES de leer, al revés que los de STAFF o Resultados: son
 * tablas normales, con una fila de encabezados arriba y un renglón por hecho.
 * Lo único que hay que saber es qué columnas ignorar.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES HOJAS DEL KPI SON LA MISMA TABLA
 * ---------------------------------------------------------------------------
 * OTS, SC y OTIF traen exactamente las mismas doce columnas y solo cambia el
 * nombre del indicador en los encabezados ('% OTS', '% SC', '% OTIF'). Por eso
 * se leen con la misma función y se guardan en una sola tabla con una columna
 * que dice cuál es.
 *
 * A la derecha de la columna L cada hoja tiene tablas dinámicas de resumen
 * (columnas N en adelante). NO se leen: se recalculan al consultar, y además
 * en el libro están desactualizadas.
 */

const XLSX_OPCIONES = { type: "buffer", cellDates: true, dense: true };

/** Espacios duros y de más. */
const limpiar = (v) =>
  v === null || v === undefined
    ? null
    : String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim() || null;

/** Clave para comparar encabezados: sin acentos, signos ni espacios. */
const clave = (v) => {
  const t = limpiar(v);
  return t
    ? t
        .replace(/%/g, " PCT ")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
    : null;
};

/** Número tolerante. Devuelve null cuando la celda no trae un número. */
function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = String(v).replace(/ /g, " ").trim();
  if (!t) return null;
  const esPct = t.endsWith("%");
  const cuerpo = esPct ? t.slice(0, -1).replace(",", ".") : t.replace(/,/g, "");
  const n = parseFloat(cuerpo.replace(/\s/g, ""));
  if (!Number.isFinite(n)) return null;
  return esPct ? n / 100 : n;
}

/**
 * Fecha a 'AAAA-MM-DD', en hora LOCAL.
 *
 * Se arma con los componentes locales y no con toISOString(), que recorrería un
 * día hacia atrás en esta zona horaria.
 */
function fecha(v) {
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

/**
 * Abre una hoja como matriz con índices absolutos.
 *
 * Se fuerza el rango a empezar en A1 porque SheetJS recorta al rango usado, y
 * 'Timeline Samples' arranca en B1: sin esto todas las columnas se correrían
 * un lugar respecto a lo documentado aquí.
 */
function leerHoja(libro, nombreHoja) {
  const hoja = libro.Sheets[nombreHoja];
  if (!hoja) return null;
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
    XLSX_OPCIONES,
  );
}

/** Busca una hoja por su nombre normalizado, tolerando espacios y acentos. */
function buscarHoja(libro, patron) {
  return libro.SheetNames.find((n) => patron.test(clave(n) || "")) || null;
}

// =============================================
// KPI (OTS / SC / OTIF)
// =============================================

/**
 * Columnas del KPI, emparejadas por el TEXTO del encabezado.
 *
 * El nombre del indicador cambia por hoja ('% OTS' / '% SC' / '% OTIF'), así
 * que esos tres se resuelven con un patrón en vez de una llave fija.
 */
const MAPA_KPI = {
  ANO: "anio",
  ANIO: "anio",
  Q: "trimestre",
  MES: "mes",
  WK: "semana",
  FECHA: "fecha",
  BU: "bu",
  META: "meta",
  // Deliberadamente ignoradas: GRAFICA es una marca de la hoja, y el
  // ponderado es el producto de otras dos columnas.
  GRAFICA: null,
};

/**
 * Lee una hoja del KPI.
 *
 * Los tres indicadores comparten estructura, así que la única diferencia es qué
 * encabezados llevan su nombre:
 *
 *   '% OTS'        el indicador de la SEMANA COMPLETA (se repite en las 3 BU)
 *   'OTS BU'       el de esta unidad de negocio   → en OTIF/OTS viene como
 *                  '% OTIF BU' y en SC como 'SC', sin el %
 *   '% POND.'      cuánto pesa esta unidad
 *   '% OTS POND.'  el producto de los dos anteriores, se recalcula
 */
function leerHojaKpi(matriz, indicador, avisos) {
  if (!matriz || matriz.length < 2) {
    avisos.push(`La hoja ${indicador} está vacía.`);
    return [];
  }

  const enc = matriz[0] || [];
  const col = {};
  const sinReconocer = [];
  const IND = clave(indicador); // OTS | SC | OTIF

  for (let c = 0; c < enc.length; c++) {
    const texto = limpiar(enc[c]);
    if (!texto) continue;
    const k = clave(texto);

    // El ponderado se descarta primero: su clave contiene la del indicador y
    // si no se atrapa aquí se confundiría con el valor de la unidad.
    if (k.includes("POND")) {
      if (k === "PCTPOND") col.ponderacion = c;
      continue;
    }
    if (k === `PCT${IND}`) { col.valor_general = c; continue; }
    if (k === `PCT${IND}BU` || k === `${IND}BU` || k === IND) { col.valor_bu = c; continue; }

    const destino = MAPA_KPI[k];
    if (destino === null) continue;            // ignorada a propósito
    if (destino === undefined) {
      // Todo lo que está a la derecha de la tabla son las dinámicas de resumen.
      // Se reportan una sola vez para no llenar la pantalla de ruido.
      sinReconocer.push(texto);
      continue;
    }
    col[destino] = c;
  }

  const faltan = ["anio", "semana", "bu"].filter((k) => col[k] === undefined);
  if (faltan.length) {
    avisos.push(
      `La hoja ${indicador} no trae las columnas ${faltan.join(", ")}. No se cargó.`,
    );
    return [];
  }

  const filas = [];
  let descartadas = 0;

  for (let r = 1; r < matriz.length; r++) {
    const f = matriz[r];
    if (!f) continue;

    const anio = numero(f[col.anio]);
    const semana = numero(f[col.semana]);
    const bu = limpiar(f[col.bu]);

    // Sin año, semana o unidad el renglón no se puede ubicar en ningún corte.
    //
    // OJO con la semana: `semana === null`, no `!semana`. El libro usa la
    // SEMANA 0 para el arranque del año (el 1 de enero, que cae antes de la
    // semana 1) y en la hoja SC esos renglones traen valor de verdad. Con `!`
    // se perdían tres renglones por hoja sin que nada lo notara.
    //
    // Se mira si hay contenido SOLO en las columnas de esta tabla, no en todo
    // el renglón: a la derecha viven las tablas dinámicas de resumen.
    if (!anio || semana === null || !bu) {
      const hayDatoPropio = Object.values(col).some(
        (c) => f[c] !== null && f[c] !== undefined && String(f[c]).trim() !== "",
      );
      if (hayDatoPropio) descartadas++;
      continue;
    }

    filas.push({
      indicador,
      anio: Math.round(anio),
      semana: Math.round(semana),
      bu: bu.toUpperCase(),
      mes: col.mes !== undefined ? limpiar(f[col.mes]) : null,
      trimestre: col.trimestre !== undefined ? numero(f[col.trimestre]) : null,
      // La columna FECHA trae basura en tres renglones de SC; si no es fecha
      // se deja en null en vez de tirar el renglón, que sí tiene su indicador.
      fecha: col.fecha !== undefined ? fecha(f[col.fecha]) : null,
      meta: col.meta !== undefined ? numero(f[col.meta]) : null,
      valor_general: col.valor_general !== undefined ? numero(f[col.valor_general]) : null,
      valor_bu: col.valor_bu !== undefined ? numero(f[col.valor_bu]) : null,
      ponderacion: col.ponderacion !== undefined ? numero(f[col.ponderacion]) : null,
    });
  }

  if (descartadas) {
    avisos.push(`${indicador}: ${descartadas} renglones sin año, semana o unidad de negocio.`);
  }
  return filas;
}

/**
 * Lee el libro del KPI completo.
 *
 * @returns {{filas, avisos, hojas}}
 */
function parsearKpi(archivo) {
  const libro = abrirLibro(archivo);
  const avisos = [];
  const filas = [];
  const hojas = [];

  for (const indicador of ["OTS", "SC", "OTIF"]) {
    const nombre = buscarHoja(libro, new RegExp(`^${indicador}$`));
    if (!nombre) {
      avisos.push(`El libro no tiene la hoja ${indicador}.`);
      continue;
    }
    const leidas = leerHojaKpi(leerHoja(libro, nombre), indicador, avisos);
    filas.push(...leidas);
    hojas.push({ hoja: nombre, indicador, filas: leidas.length });
  }

  if (filas.length === 0) {
    avisos.push("El libro de KPI no trae ningún renglón utilizable.");
  }

  return { filas, avisos, hojas };
}

// =============================================
// MUESTRAS (Timeline Samples)
// =============================================

/**
 * Columnas de 'Timeline Samples', por el texto del encabezado.
 *
 * Las que no están aquí se ignoran: a la derecha de la tabla viven el resumen
 * y el semáforo, que son fórmulas.
 */
const MAPA_MUESTRAS = {
  AREA: "area",
  PERIODO: "periodo",
  BU: "bu",
  TIPO: "tipo",
  FLIA: "familia",
  CUSTOMER: "cliente",
  SAMPLESID: "muestra_id",
  STARTDATE: "inicio",
  FINISHDATE: "fin",
  TIMEPROCESSDAYS: "dias_proceso",
  OBJETIVETIMEDAYS: "dias_objetivo",
  SKU: "sku",
  DESCRIPTION: "descripcion",
  QTY: "cantidad",
  PRSPZS: "pares",
  OK: "en_tiempo",
  LATE: "con_retraso",
  STATUS: "estado",
  DELIVERY: "entrega",
  COMMENTS: "comentarios",
};

const NUMERICAS = new Set([
  "dias_proceso", "dias_objetivo", "cantidad", "pares", "en_tiempo", "con_retraso",
]);
const FECHAS = new Set(["inicio", "fin"]);

const HOJA_MUESTRAS = /^TIMELINESAMPLES$/;

/**
 * Lee el libro de muestras.
 *
 * Se lee SOLO el detalle. Las hojas de resumen del libro se recalculan aquí, y
 * hay una razón concreta: sus fórmulas de '% Cumplimiento' y '% Retraso' están
 * cruzadas —la de cumplimiento cuenta los finalizados CON retraso— así que el
 * número que sale del libro es justo el contrario del que dice su etiqueta.
 */
function parsearMuestras(archivo) {
  const libro = abrirLibro(archivo);
  const avisos = [];

  const nombre = buscarHoja(libro, HOJA_MUESTRAS);
  if (!nombre) {
    return {
      filas: [],
      avisos: ["El libro no tiene la hoja 'Timeline Samples'."],
      hojas: [],
    };
  }

  const matriz = leerHoja(libro, nombre);
  if (!matriz || matriz.length < 2) {
    return { filas: [], avisos: ["La hoja 'Timeline Samples' está vacía."], hojas: [] };
  }

  const enc = matriz[0] || [];
  const col = {};
  for (let c = 0; c < enc.length; c++) {
    const destino = MAPA_MUESTRAS[clave(enc[c])];
    // Solo la PRIMERA aparición: a la derecha hay encabezados del resumen que
    // repiten alguna palabra suelta.
    if (destino && col[destino] === undefined) col[destino] = c;
  }

  const faltan = ["bu", "estado"].filter((k) => col[k] === undefined);
  if (faltan.length) {
    return {
      filas: [],
      avisos: [`'Timeline Samples' no trae las columnas ${faltan.join(", ")}. No se cargó.`],
      hojas: [],
    };
  }

  const filas = [];
  let descartadas = 0;

  for (let r = 1; r < matriz.length; r++) {
    const f = matriz[r];
    if (!f) continue;

    // Un renglón cuenta si tiene unidad de negocio o estado. El libro deja
    // renglones a medias al final de la tabla.
    const bu = limpiar(f[col.bu]);
    const estado = limpiar(f[col.estado]);
    if (!bu && !estado) {
      if (f.some((c) => c !== null && String(c).trim() !== "")) descartadas++;
      continue;
    }

    const fila = {};
    for (const [destino, c] of Object.entries(col)) {
      const v = f[c];
      fila[destino] = NUMERICAS.has(destino)
        ? numero(v)
        : FECHAS.has(destino)
          ? fecha(v)
          : limpiar(v);
    }
    filas.push(fila);
  }

  if (descartadas) {
    avisos.push(`${descartadas} renglones de 'Timeline Samples' sin unidad de negocio ni estado.`);
  }

  return { filas, avisos, hojas: [{ hoja: nombre, filas: filas.length }] };
}

module.exports = {
  parsearKpi,
  parsearMuestras,
  numero,
  fecha,
  clave,
};
