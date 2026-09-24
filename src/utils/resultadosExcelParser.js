const XLSX = require("xlsx");

/**
 * Parser del Excel de Resultados ('DATA-FCMX-AAAA Mes.xlsx').
 *
 * Catorce hojas, pero solo SIETE hechos distintos: la mitad del libro son
 * re-acomodos de los mismos números para alimentar una gráfica.
 *
 *   'Fact acumulada QTY'  facturación en unidades, año × mes × BU (2020→)
 *   'Fact acumulada USD'  lo mismo en dólares
 *   'Capacity'            capacidad instalada y comprometida por BU
 *   'Human Resources…'    plantilla, rotación, horas y tiempo de ciclo
 *   'Energy Consuption'   KWh y euros
 *   'Compound Cons.'      toneladas producidas, recicladas y desechadas
 *   'CROCS' 'SOLES'       producido y scrap por BU, en italiano
 *   'FOAM DESIGN' 'DUAL COLOR'
 *   'Margin'              estado de resultados por BU
 *
 * NO se leen 'Q.TY (Billed)' ni 'USD (Billed)': son 'Fact acumulada' puesta de
 * lado con cinco años en paralelo, más los pivotes de sus gráficas. Tampoco
 * 'TOTAL SCRAP', que es la suma exacta de las otras cuatro hojas de scrap
 * (5,828,445 producidas y 810,196 de rechazo en 2026, al kilo). Guardar un
 * total que se puede sumar solo invita a que un día no cuadre.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE LEE POR TEXTO DE ENCABEZADO Y NO POR POSICIÓN
 * ---------------------------------------------------------------------------
 * Cada hoja acomoda los años a su manera: 'Fact acumulada' los apila cada 9 o
 * 10 renglones, 'Capacity' cada 19, 'Energy' cada 17, y 'Compound Cons.' y las
 * de scrap los ponen lado a lado. Y dentro de una misma hoja el juego de
 * columnas cambia: en 'Compound Cons.' el bloque de 2022 trae
 * 'Used / Disposed / Sold' donde los demás años traen
 * 'Powder Recycled / Purge Recycled / Monthly Fee'.
 *
 * Por eso cada bloque se resuelve en dos pasos: se localiza el ancla del año y
 * luego se lee su renglón de encabezados, emparejando cada columna por el
 * TEXTO. Una columna que no se reconoce se ignora y se avisa, en vez de
 * cargarse como si fuera otra cosa.
 */

// =============================================
// NORMALIZACIÓN
// =============================================

const limpiar = (v) =>
  v === null || v === undefined
    ? null
    : String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim() || null;

/**
 * Clave para comparar textos: sin acentos, sin espacios ni signos, en mayúsculas.
 *
 * El '%' se traduce a 'PCT' en vez de borrarse, porque borrarlo hace que
 * 'Scarto' y '% Scarto' queden idénticos — y en las hojas de scrap esas dos
 * columnas son vecinas, así que el porcentaje terminaba cargado como si fuera
 * el número de piezas rechazadas.
 */
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
 * Meses en los tres idiomas del libro.
 *
 * 'Febrary' no es una errata mía: está así escrito en 'Capacity' y en
 * 'Human Resources' los cinco años.
 */
const MESES = {
  JANUARY: 1, GENNAIO: 1, GEN: 1, ENERO: 1, JAN: 1,
  FEBRUARY: 2, FEBRARY: 2, FEBBRAIO: 2, FEB: 2, FEBRERO: 2,
  MARCH: 3, MARZO: 3, MAR: 3,
  APRIL: 4, APRILE: 4, APR: 4, ABRIL: 4,
  MAY: 5, MAGGIO: 5, MAG: 5, MAYO: 5,
  JUNE: 6, GIUGNO: 6, GIU: 6, JUN: 6, JUNIO: 6,
  JULY: 7, LUGLIO: 7, LUG: 7, JUL: 7, JULIO: 7,
  AUGUST: 8, AGOSTO: 8, AGO: 8, AUG: 8,
  SEPTEMBER: 9, SETTEMBRE: 9, SET: 9, SEP: 9, SEPTIEMBRE: 9,
  OCTOBER: 10, OTTOBRE: 10, OTT: 10, OCT: 10, OCTUBRE: 10,
  NOVEMBER: 11, NOVEMBRE: 11, NOV: 11, NOVIEMBRE: 11,
  DECEMBER: 12, DICEMBRE: 12, DIC: 12, DEC: 12, DICIEMBRE: 12,
};

const mesDe = (v) => MESES[clave(v)] ?? null;

// =============================================
// UNIDADES DE NEGOCIO
// =============================================

/**
 * El mismo negocio se llama distinto en cada hoja, y a lo largo de los años
 * cambió hasta el espaciado ('Crocs(pairs)' en 2020, 'Crocs (pairs)' en 2023).
 * Aquí se resuelven todos los alias a un código.
 *
 * Dos equivalencias que el libro solo deja ver en las fórmulas de 'Margin':
 *   Foam Design = Technical product   (=' Fact acumulada QTY'!$N$41)
 *   Footwear    = Sole + Dual Color   (=$N$42 + $N$43)
 * La segunda NO se puede deshacer, así que FOOTWEAR se queda como su propia
 * unidad y solo existe en el estado de resultados.
 */
const ALIAS_BU = {
  CROCSPAIRS: "CROCS", CROCS: "CROCS",
  TECHNICALPRODUCTUNIT: "FOAM_DESIGN", TECHNICALPRODUCT: "FOAM_DESIGN",
  FOAMDESIGNPIECES: "FOAM_DESIGN", FOAMDESIGN: "FOAM_DESIGN",
  SOLEPAIRS: "SUELA", SOLE: "SUELA", SOLESPAIRS: "SUELA", SOLES: "SUELA",
  DUALCOLORPAIRS: "DUAL_COLOR", DUALCOLOR: "DUAL_COLOR",
  COMPOUNDTONS: "COMPOUND", COMPOUND: "COMPOUND",
  FOOTWEAR: "FOOTWEAR",
};

const buDe = (v) => ALIAS_BU[clave(v)] ?? null;

/** Filas y columnas de total, que se recalculan y nunca se leen. */
const ES_TOTAL = (v) => {
  const k = clave(v);
  return !!k && /^(TOTAL|TOTALE|TOTALGENERAL|TOTALGENERALPAIRSUNIT|TOT)$/.test(k);
};

// =============================================
// LECTURA DE HOJAS
// =============================================

/**
 * Abre una hoja como matriz con ÍNDICES ABSOLUTOS.
 *
 * SheetJS recorta al rango usado; varias hojas de este libro empiezan en B4 o
 * A5, así que sin forzar el rango a A1 las columnas se recorren y las
 * posiciones documentadas aquí dejarían de significar lo mismo.
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
    { type: "buffer", cellDates: true, dense: true },
  );
}

/**
 * Encuentra la hoja por su nombre, tolerando basura alrededor.
 *
 * Hace falta porque una de las pestañas se llama, literalmente,
 * 'Human Resources\t\t' — con dos tabuladores que nadie ve en Excel.
 */
function buscarHoja(libro, patron) {
  return libro.SheetNames.find((n) => patron.test(clave(n) || "")) || null;
}

/** Celdas de un renglón que traen un año de cuatro dígitos. */
function anclasDeAnio(matriz, filas, cols) {
  const res = [];
  for (const r of filas) {
    const fila = matriz[r];
    if (!fila) continue;
    for (const c of cols) {
      const v = fila[c];
      if (typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2100) {
        res.push({ fila: r, col: c, anio: v });
      }
    }
  }
  return res;
}

// =============================================
// FACTURACIÓN  ('Fact acumulada QTY' / 'Fact acumulada USD')
// =============================================

/**
 * Siete bloques de año apilados, con los meses en las columnas B..M y las
 * unidades de negocio en los renglones.
 *
 * Los bloques NO están a distancia fija (van en los renglones 1, 10, 19, 28,
 * 38, 48 y 58), así que cada uno se lee desde su ancla hasta toparse con el
 * renglón de 'Total general', que se ignora porque se recalcula.
 */
function leerFacturacion(matriz, metrica, avisos, etiqueta) {
  const valores = [];
  const anclas = anclasDeAnio(matriz, [...matriz.keys()], [0]);

  for (const { fila, anio } of anclas) {
    // Los meses viven en el mismo renglón del año
    const mesPorCol = new Map();
    for (let c = 1; c < (matriz[fila] || []).length; c++) {
      const m = mesDe(matriz[fila][c]);
      if (m) mesPorCol.set(c, m);
    }
    if (mesPorCol.size === 0) {
      avisos.push(`${etiqueta}: el bloque de ${anio} no trae encabezados de mes.`);
      continue;
    }

    for (let r = fila + 1; r < matriz.length; r++) {
      const fil = matriz[r];
      if (!fil) continue;
      const etq = fil[0];
      if (ES_TOTAL(etq)) break; // fin del bloque
      // Un renglón con otro año es el arranque del siguiente bloque
      if (typeof etq === "number" && etq >= 2000 && etq <= 2100) break;

      const bu = buDe(etq);
      if (!bu) continue;

      for (const [c, mes] of mesPorCol) {
        const v = numero(fil[c]);
        if (v === null) continue;
        valores.push({ anio, mes, bu, metrica_codigo: metrica, valor: v });
      }
    }
  }

  return valores;
}

// =============================================
// CAPACIDAD  ('Capacity')
// =============================================

/**
 * Tres bloques de año. Cada uno trae el renglón de 'Daily Installed Capacity'
 * y luego doce renglones de mes con la capacidad comprometida y el % de uso
 * por unidad de negocio.
 *
 * El % de uso NO se lee: es comprometida / instalada y se recalcula. La
 * capacidad instalada se guarda como un valor mensual repetido, porque el
 * libro la deja fija por año pero nada garantiza que no cambie.
 */
function leerCapacidad(matriz, avisos) {
  const valores = [];
  const anclas = anclasDeAnio(matriz, [...matriz.keys()], [1]);

  for (const { fila, anio } of anclas) {
    // El renglón de BU está dos abajo del año; el de capacidad instalada, tres
    const filaBu = fila + 2;
    const filaInstalada = fila + 3;
    if (!matriz[filaBu] || !matriz[filaInstalada]) continue;

    // Columna -> BU, leyendo el renglón de encabezados de unidad de negocio
    const buPorCol = new Map();
    for (let c = 0; c < matriz[filaBu].length; c++) {
      const bu = buDe(matriz[filaBu][c]);
      if (bu) buPorCol.set(c, bu);
    }
    if (buPorCol.size === 0) {
      avisos.push(`Capacidad: el bloque de ${anio} no trae encabezados de unidad de negocio.`);
      continue;
    }

    for (const [c, bu] of buPorCol) {
      const inst = numero(matriz[filaInstalada][c]);
      if (inst === null) continue;
      for (let mes = 1; mes <= 12; mes++) {
        valores.push({ anio, mes, bu, metrica_codigo: "cap_instalada", valor: inst });
      }
    }

    // Doce renglones de mes, a partir de dos abajo del de instalada
    for (let r = filaInstalada + 2; r <= filaInstalada + 14 && r < matriz.length; r++) {
      const fil = matriz[r];
      if (!fil) continue;
      const mes = mesDe(fil[2]);
      if (!mes) continue;

      const dias = numero(fil[1]);
      if (dias !== null) {
        valores.push({ anio, mes, bu: "PLANTA", metrica_codigo: "cap_dias_habiles", valor: dias });
      }
      for (const [c, bu] of buPorCol) {
        const v = numero(fil[c]);
        if (v === null) continue;
        valores.push({ anio, mes, bu, metrica_codigo: "cap_comprometida", valor: v });
      }
    }
  }

  return valores;
}

/**
 * La foto de carga que vive arriba de 'Capacity': la PO abierta traducida a
 * días de trabajo por unidad de negocio.
 *
 * Es un corte semanal, no una serie: el renglón dice 'Week : 45' y se
 * sobreescribe. Se guarda con mes 0 para que conviva con lo mensual sin
 * pretender ser un mes.
 */
function leerCargaPo(matriz, anioLibro) {
  const valores = [];
  let semana = null;

  for (let r = 0; r < Math.min(matriz.length, 20); r++) {
    const fil = matriz[r] || [];
    for (const celda of fil) {
      const t = limpiar(celda);
      const m = t && t.match(/WEEK\s*:?\s*(\d{1,2})/i);
      if (m) semana = Number(m[1]);
    }
    const bu = buDe(fil[2]);
    if (!bu) continue;
    const qty = numero(fil[3]);
    const dias = numero(fil[4]);
    if (qty !== null) {
      valores.push({ anio: anioLibro, mes: 0, bu, metrica_codigo: "carga_po_qty", valor: qty });
    }
    if (dias !== null) {
      valores.push({ anio: anioLibro, mes: 0, bu, metrica_codigo: "carga_po_dias", valor: dias });
    }
  }

  return { valores, semana };
}

// =============================================
// BLOQUES CON ENCABEZADO DE TEXTO
// =============================================

/**
 * Lee un bloque cuyo renglón de encabezados nombra cada columna.
 *
 * Es el caso de Energía, Compound y Personal. Se empareja por TEXTO, que es lo
 * único estable: en 'Compound Cons.' el bloque de 2022 usa otro juego de
 * columnas que el resto de los años, y así simplemente no empata y se avisa,
 * en vez de cargar 'Sold (Tons)' como si fuera 'Purge Recycled'.
 *
 * @param {Number} filaEnc    renglón de encabezados
 * @param {Number} desde      primera columna del bloque
 * @param {Number} hasta      última columna del bloque (exclusiva)
 * @param {Number} colMes     columna donde vive el nombre del mes
 * @param {Object} mapa       { CLAVEENCABEZADO: 'metrica' }
 * @param {Number} filaIni    primer renglón de datos
 */
function leerBloqueConEncabezado(
  matriz, filaEnc, desde, hasta, colMes, mapa, filaIni, anio, bu, avisos, etiqueta,
) {
  const valores = [];
  const enc = matriz[filaEnc] || [];

  const metricaPorCol = new Map();
  const sinReconocer = [];
  for (let c = desde; c < Math.min(hasta, enc.length); c++) {
    const texto = limpiar(enc[c]);
    if (!texto) continue;
    const k = clave(texto);
    if (k === "MONTH" || k === "WORKINGDAYSXMONTH") continue;
    // null = derivada del propio Excel, se ignora a propósito y sin ruido.
    // undefined = no está en el catálogo, y eso sí hay que avisarlo.
    const metrica = mapa[k];
    if (metrica === null) continue;
    if (metrica === undefined) sinReconocer.push(texto);
    else metricaPorCol.set(c, metrica);
  }

  if (metricaPorCol.size === 0) {
    avisos.push(`${etiqueta}: el bloque de ${anio} no trae ninguna columna reconocible.`);
    return valores;
  }
  if (sinReconocer.length) {
    avisos.push(
      `${etiqueta} ${anio}: columnas ignoradas por no estar en el catálogo: ` +
        `${[...new Set(sinReconocer)].join(", ")}.`,
    );
  }

  for (let r = filaIni; r < filaIni + 14 && r < matriz.length; r++) {
    const fil = matriz[r];
    if (!fil) continue;
    if (ES_TOTAL(fil[colMes])) break;
    const mes = mesDe(fil[colMes]);
    if (!mes) continue;

    for (const [c, metrica] of metricaPorCol) {
      const v = numero(fil[c]);
      if (v === null) continue;
      valores.push({ anio, mes, bu, metrica_codigo: metrica, valor: v });
    }
  }

  return valores;
}

/**
 * Energía: cinco bloques apilados, el año en la columna A del encabezado.
 *
 * Es la única hoja que se lee POR POSICIÓN y no por texto, por dos razones que
 * hacen inservible el encabezado:
 *
 *   El importe se titula con el símbolo del euro, y al quitarle los signos no
 *   queda absolutamente nada con qué emparejarlo.
 *
 *   La columna de al lado se llama '€/Kwh' y, normalizada, queda igual que
 *   'KWh'. Emparejar por texto cargaría el precio unitario como si fuera el
 *   consumo.
 *
 * Solo se leen C (KWh) y D (importe). El resto de la hoja —€/KWh, €/par,
 * KWh/par contra producido, bueno y facturado— son razones que se recalculan.
 */
const COL_ENERGIA_KWH = 2;
const COL_ENERGIA_IMPORTE = 3;

function leerEnergia(matriz, avisos) {
  const valores = [];
  const anclas = anclasDeAnio(matriz, [...matriz.keys()], [0]);

  for (const { fila, anio } of anclas) {
    // Se valida la posición contra el encabezado antes de leer nada: si alguien
    // mete una columna, es preferible no cargar el bloque a cargarlo corrido.
    if (clave((matriz[fila] || [])[COL_ENERGIA_KWH]) !== "KWH") {
      avisos.push(
        `Energía: el bloque de ${anio} no tiene 'KWh' en la columna C. No se cargó; ` +
          "revisar si se insertaron columnas en la hoja.",
      );
      continue;
    }

    for (let r = fila + 1; r < fila + 14 && r < matriz.length; r++) {
      const fil = matriz[r];
      if (!fil) continue;
      if (ES_TOTAL(fil[1])) break;
      const mes = mesDe(fil[1]);
      if (!mes) continue;

      const kwh = numero(fil[COL_ENERGIA_KWH]);
      const eur = numero(fil[COL_ENERGIA_IMPORTE]);
      if (kwh !== null) {
        valores.push({ anio, mes, bu: "PLANTA", metrica_codigo: "ene_kwh", valor: kwh });
      }
      if (eur !== null) {
        valores.push({ anio, mes, bu: "PLANTA", metrica_codigo: "ene_eur", valor: eur });
      }
    }
  }
  return valores;
}

/** Compound: un solo renglón de anclas, con los años lado a lado. */
const MAPA_COMPOUND = {
  PRODUCEDTONS: "comp_producido",
  POWDERRECYCLEDTONS: "comp_polvo",
  PURGERECYCLEDTONS: "comp_purga",
  SCRAPTOTALTONS: "comp_scrap",
  MONTHLYFEEDISPOSEDMXN: "comp_fee_mxn",
  // Derivadas del propio Excel: no se leen, se recalculan
  TOTALRECYCLEDTONS: null,
  PCTSCRAP: null,
  PCTRECYCLED: null,
};

function leerCompound(matriz, avisos) {
  const valores = [];
  const filaAnclas = matriz.findIndex(
    (f) => (f || []).some((v) => typeof v === "number" && v >= 2000 && v <= 2100),
  );
  if (filaAnclas < 0) {
    avisos.push("Compound: no se encontró el renglón con los años.");
    return valores;
  }

  const anclas = anclasDeAnio(matriz, [filaAnclas], [...(matriz[filaAnclas] || []).keys()]);
  const filaEnc = filaAnclas + 2;

  anclas.forEach((a, i) => {
    const hasta = anclas[i + 1] ? anclas[i + 1].col : (matriz[filaEnc] || []).length;
    valores.push(
      ...leerBloqueConEncabezado(
        matriz, filaEnc, a.col, hasta, 2, MAPA_COMPOUND, filaEnc + 1, a.anio, "PLANTA", avisos, "Compound",
      ),
    );
  });

  return valores;
}

/** Personal: tres juegos de bloques, todos con los años lado a lado. */
const MAPA_PERSONAL = {
  TOTALEMPLOYEES: "hr_empleados",
  PCTTURNOVER: "hr_rotacion",
  WORKINGHOUR: "hr_horas_trabajadas",
  STANDARDHOURS: "hr_horas_estandar",
  EXTRAHOURS: "hr_horas_extra",
  TOTALPAIDHOURS: "hr_horas_pagadas",
  QTYPRODUCED: "hr_qty_producida",
  QTYPRODUCEDGOOD: "hr_qty_buena",
  // Derivadas: % de horas extra, minutos, tiempo de ciclo y la cantidad
  // facturada (que ya viene de 'Fact acumulada'). Se recalculan.
  PCTHOURSEXTRA: null,
  PCTHOUREXTRA: null,
  TOTALMINUTES: null,
  QTYBILLED: null,
  AVERAGECYCLETIMEMINXUNITS: null,
  CT: null,
  QUANTITYGOODPRODUCED: null,
};

function leerPersonal(matriz, avisos) {
  const valores = [];

  // Los bloques se reconocen porque el renglón de abajo del año dice
  // 'Human Resources' y el de más abajo trae 'Month'.
  for (let r = 0; r < matriz.length; r++) {
    const anclas = anclasDeAnio(matriz, [r], [...(matriz[r] || []).keys()]);
    if (anclas.length === 0) continue;

    const filaEnc = r + 2;
    const enc = matriz[filaEnc];
    if (!enc) continue;
    // Solo son bloques de datos los que tienen 'Month' bajo el año
    const tieneMes = anclas.some((a) => clave(enc[a.col]) === "MONTH");
    if (!tieneMes) continue;

    anclas.forEach((a, i) => {
      const hasta = anclas[i + 1] ? anclas[i + 1].col : enc.length;
      valores.push(
        ...leerBloqueConEncabezado(
          matriz, filaEnc, a.col, hasta, a.col, MAPA_PERSONAL, filaEnc + 1, a.anio, "PLANTA", avisos, "Personal",
        ),
      );
    });
  }

  return valores;
}

// =============================================
// SCRAP  ('CROCS' / 'SOLES' / 'FOAM DESIGN' / 'DUAL COLOR')
// =============================================

/**
 * Cuatro hojas iguales, una por unidad de negocio, con los años lado a lado y
 * los meses en italiano.
 *
 * Solo se leen 'Prodotte' y 'Scarto'. 'Nette' es la resta y '% Scarto' la
 * razón: las dos se recalculan.
 */
const MAPA_SCRAP = {
  PRODOTTE: "scrap_producido",
  SCARTO: "scrap_rechazo",
  // Derivadas, se recalculan: Nette = Prodotte − Scarto, y el porcentaje es
  // su razón. Van explícitas para que se vea que se ignoran a propósito.
  NETTE: null,
  PCTSCARTO: null,
};

function leerScrap(matriz, bu, avisos) {
  const valores = [];
  const filaAnclas = matriz.findIndex(
    (f) => (f || []).some((v) => typeof v === "number" && v >= 2000 && v <= 2100),
  );
  if (filaAnclas < 0) {
    avisos.push(`Scrap ${bu}: no se encontró el renglón con los años.`);
    return valores;
  }

  const anclas = anclasDeAnio(matriz, [filaAnclas], [...(matriz[filaAnclas] || []).keys()]);

  for (const a of anclas) {
    // El año y sus encabezados ('Prodotte', 'Scarto'…) van en el MISMO renglón
    const metricaPorCol = new Map();
    for (let c = a.col + 1; c <= a.col + 4; c++) {
      const metrica = MAPA_SCRAP[clave((matriz[filaAnclas] || [])[c])];
      if (metrica) metricaPorCol.set(c, metrica);
    }
    if (metricaPorCol.size === 0) continue;

    for (let r = filaAnclas + 1; r < filaAnclas + 14 && r < matriz.length; r++) {
      const fil = matriz[r];
      if (!fil) continue;
      if (ES_TOTAL(fil[a.col])) break;
      const mes = mesDe(fil[a.col]);
      if (!mes) continue;

      for (const [c, metrica] of metricaPorCol) {
        const v = numero(fil[c]);
        if (v === null) continue;
        valores.push({ anio: a.anio, mes, bu, metrica_codigo: metrica, valor: v });
      }
    }
  }

  return valores;
}

// =============================================
// MARGEN  ('Margin')
// =============================================

/**
 * Estado de resultados por unidad de negocio. Va con mes 0: es anual.
 *
 * Solo se leen los importes. Los porcentajes y el valor por unidad que trae el
 * Excel se recalculan (el % es sobre Sales y el unitario sobre Q.ty Sold, lo
 * comprobé contra las celdas).
 *
 * Las cifras están en EUROS: el bloque de 2024 sale de 'Fact acumulada USD'
 * multiplicada por el factor USD→EUR de la propia hoja.
 */
const MAPA_MARGEN = {
  QTYSOLD: "mg_qty_vendida",
  SALES: "mg_ventas",
  VARIABLECOSTS: "mg_costo_variable",
  OFWITCHRAWMATERIAL: "mg_materia_prima",
  OFWITCHUTILITIES: "mg_utilities",
  OFWITCHTRANSPORTS: "mg_transportes",
  OFWITCHCOMMISSIONS: "mg_comisiones",
  CONTRIBUTIONMARGINENI: "mg_margen_eni",
  DIRECTLABOR: "mg_mano_obra_directa",
  CONTRIBUTIONMARGINFINPROJECT: "mg_margen_finproject",
  FIXEDCOSTS: "mg_costos_fijos",
  ILLABOR: "mg_mano_obra_indirecta",
  OFWITCHMAINTENANCE: "mg_mantenimiento",
  OTHEROPERATINGINCOMEEXPENSES: "mg_otros",
  EBITDA: "mg_ebitda",
  DEPRECIATION: "mg_depreciacion",
  EBIT: "mg_ebit",
};

/** Columna donde vive el nombre del concepto del P&L. */
const COL_CONCEPTO_MARGEN = 2;

function leerMargen(matriz, anioLibro, avisos) {
  const valores = [];

  // Un bloque arranca donde aparece 'Q.ty Sold' en la columna de conceptos
  const arranques = [];
  for (let r = 0; r < matriz.length; r++) {
    if (clave((matriz[r] || [])[COL_CONCEPTO_MARGEN]) === "QTYSOLD") arranques.push(r);
  }
  if (arranques.length === 0) {
    avisos.push("Margen: no se encontró ningún bloque de estado de resultados.");
    return { valores, sinAnio: [] };
  }

  const sinAnio = [];

  for (const inicio of arranques) {
    // El renglón de BU está arriba del de 'Q.ty Sold'
    const filaBu = inicio - 1;
    const buPorCol = new Map();
    for (let c = 0; c < (matriz[filaBu] || []).length; c++) {
      if (ES_TOTAL(matriz[filaBu][c])) continue;
      const bu = buDe(matriz[filaBu][c]);
      if (bu) buPorCol.set(c, bu);
    }
    if (buPorCol.size === 0) continue;

    // El año vive en la columna A, en algún renglón del bloque. El primer
    // bloque del archivo de agosto NO lo trae: está pegado a mano.
    let anio = null;
    for (let r = filaBu; r < inicio + 18 && r < matriz.length; r++) {
      const v = (matriz[r] || [])[0];
      if (typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2100) {
        anio = v;
        break;
      }
    }

    const filas = [];
    for (let r = inicio; r < inicio + 20 && r < matriz.length; r++) {
      const metrica = MAPA_MARGEN[clave((matriz[r] || [])[COL_CONCEPTO_MARGEN])];
      if (!metrica) continue;
      for (const [c, bu] of buPorCol) {
        const v = numero(matriz[r][c]);
        if (v === null) continue;
        filas.push({ mes: 0, bu, metrica_codigo: metrica, valor: v });
      }
    }
    if (filas.length === 0) continue;

    if (anio === null) {
      // Se etiqueta con el año del archivo y se avisa, en lugar de tirarlo: es
      // el único bloque del libro con costos reales.
      sinAnio.push({ filas: filas.length, usado: anioLibro });
      anio = anioLibro;
    }

    valores.push(...filas.map((f) => ({ ...f, anio })));
  }

  if (sinAnio.length) {
    const total = sinAnio.reduce((a, b) => a + b.filas, 0);
    avisos.push(
      `Margen: ${sinAnio.length} bloque(s) del estado de resultados (${total} valores) no ` +
        `traen el año en la hoja. Se cargaron como ${anioLibro}, que es el del nombre del ` +
        "archivo. Conviene escribir el año en la columna A del Excel para no depender de eso.",
    );
  }

  return { valores, sinAnio };
}

// =============================================
// AÑO Y MES DEL ARCHIVO
// =============================================

/**
 * Año y mes de corte, sacados del nombre ('DATA-FCMX-2026 Agosto.xlsx').
 *
 * El año se usa para fechar lo que la hoja no fecha: la foto de carga de PO y
 * el bloque del estado de resultados que viene sin etiqueta.
 */
function leerCorteDelNombre(nombreArchivo) {
  if (!nombreArchivo) return null;
  const texto = String(nombreArchivo);
  const anioM = texto.match(/(20\d{2})/);
  if (!anioM) return null;

  let mes = null;
  for (const [nombre, numero_] of Object.entries(MESES)) {
    const re = new RegExp(`\\b${nombre}\\b`, "i");
    if (re.test(clave(texto) || "") || re.test(texto)) {
      mes = numero_;
      break;
    }
  }
  return { anio: Number(anioM[1]), mes };
}

// =============================================
// ENTRADA PRINCIPAL
// =============================================

/**
 * Lee el libro completo.
 *
 * @param {String|Buffer} archivo
 * @param {String} nombreArchivo  de donde salen el año y el mes de corte
 * @returns {{valores, avisos, corte, semanaCarga, hojasLeidas, hojasIgnoradas}}
 */
function parsearResultados(archivo, nombreArchivo) {
  const libro = abrirLibro(archivo);
  const avisos = [];
  const valores = [];
  const hojasLeidas = [];

  const corte = leerCorteDelNombre(nombreArchivo) || {
    anio: new Date().getFullYear(),
    mes: null,
  };
  if (!leerCorteDelNombre(nombreArchivo)) {
    avisos.push(
      "El nombre del archivo no trae el año ('DATA-FCMX-2026 Agosto.xlsx'). Se usó " +
        `${corte.anio} para fechar la carga de PO y el estado de resultados sin año.`,
    );
  }

  const tomar = (patron, fn, etiqueta) => {
    const nombre = buscarHoja(libro, patron);
    if (!nombre) {
      avisos.push(`No se encontró la hoja de ${etiqueta}.`);
      return null;
    }
    const matriz = leerHoja(libro, nombre);
    if (!matriz) return null;
    const antes = valores.length;
    const res = fn(matriz);
    if (Array.isArray(res)) valores.push(...res);
    hojasLeidas.push({ hoja: nombre, etiqueta, valores: valores.length - antes });
    return res;
  };

  tomar(/^FACTACUMULADAQTY$/, (m) => leerFacturacion(m, "fact_qty", avisos, "Facturación QTY"), "facturación en unidades");
  tomar(/^FACTACUMULADAUSD$/, (m) => leerFacturacion(m, "fact_usd", avisos, "Facturación USD"), "facturación en dólares");

  let semanaCarga = null;
  tomar(/^CAPACITY$/, (m) => {
    const cap = leerCapacidad(m, avisos);
    const carga = leerCargaPo(m, corte.anio);
    semanaCarga = carga.semana;
    return [...cap, ...carga.valores];
  }, "capacidad");

  tomar(/^HUMANRESOURCES$/, (m) => leerPersonal(m, avisos), "personal");
  tomar(/^ENERGYCONSUPTION$/, (m) => leerEnergia(m, avisos), "energía");
  tomar(/^COMPOUNDCONS$/, (m) => leerCompound(m, avisos), "compound");

  for (const [patron, bu, etiqueta] of [
    [/^CROCS$/, "CROCS", "scrap de Crocs"],
    [/^SOLES$/, "SUELA", "scrap de Suela"],
    [/^FOAMDESIGN$/, "FOAM_DESIGN", "scrap de Foam Design"],
    [/^DUALCOLOR$/, "DUAL_COLOR", "scrap de Dual Color"],
  ]) {
    tomar(patron, (m) => leerScrap(m, bu, avisos), etiqueta);
  }

  let margenSinAnio = [];
  tomar(/^MARGIN$/, (m) => {
    const r = leerMargen(m, corte.anio, avisos);
    margenSinAnio = r.sinAnio;
    return r.valores;
  }, "margen");

  const hojasIgnoradas = libro.SheetNames.filter(
    (n) => !hojasLeidas.some((h) => h.hoja === n),
  );

  return {
    valores,
    avisos,
    corte,
    semanaCarga,
    hojasLeidas,
    hojasIgnoradas,
    margenSinAnio,
  };
}

module.exports = {
  parsearResultados,
  leerCorteDelNombre,
  numero,
  mesDe,
  buDe,
};
