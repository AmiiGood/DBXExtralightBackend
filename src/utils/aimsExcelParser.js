const XLSX = require("xlsx");

/**
 * Lector del libro de indicadores de AIMS ('KPIs AIMS rev8 Oct 21.xlsx').
 *
 * Una hoja por indicador ('AIMS-KPI-01' … 'AIMS-KPI-12'), todas con el mismo
 * molde: arriba la ficha (KPI, definición, cálculo, target, fuente) y abajo una
 * tabla mes por mes. Al lado traen una tabla dinámica para la gráfica, que NO
 * se lee: sale de la misma tabla y su "Total general" suma los porcentajes de
 * los meses (464% en KPI-11, 713 minutos de MTTR), así que el acumulado del año
 * se calcula aquí.
 *
 * ---------------------------------------------------------------------------
 * QUÉ MESES CUENTAN: LOS QUE EL ÁREA MARCÓ "OK"
 * ---------------------------------------------------------------------------
 * La columna A de cada tabla ("Grafica") dice OK en los meses ya cerrados, y es
 * lo que filtra la gráfica del libro. Se respeta tal cual: un mes sin OK no
 * entra aunque tenga números. Importa porque los meses sin datos no salen
 * vacíos en el libro:
 *
 *   KPI-04  octubre a diciembre dan 100% de capacitación (IFERROR(…, 1))
 *   KPI-03  octubre a diciembre dan 0% de plan de mantenimiento
 *   KPI-02  octubre trae datos a medias (Crocs en cero)
 *
 * Un mes con OK pero sin valor (los legales de julio a septiembre, "pendiente
 * al cierre") se guarda como sin dato, no como cero.
 *
 * ---------------------------------------------------------------------------
 * LO QUE SE CALCULA DISTINTO AL LIBRO, A PROPÓSITO
 * ---------------------------------------------------------------------------
 *   KPI-03  El libro divide TODAS las máquinas con mantenimiento hecho entre
 *           las planeadas, aunque no estuvieran en el plan (abril: 6/9 =
 *           66.7%). Aquí cuenta solo lo planeado que se hizo (5/9 = 55.6%).
 *   KPI-06  La columna "% Cumplimiento" de la hoja promedia RCO y OR; el
 *           indicador es OR, y su gráfica en el libro ya usa solo OR.
 *
 * Las columnas se buscan por su encabezado, no por su letra.
 */

const normal = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const MESES = {
  ene: 1, enero: 1, january: 1,
  feb: 2, febrero: 2, february: 2, febrary: 2, // el libro dice "Febrary"
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, december: 12,
};
const mesDe = (v) => MESES[normal(v)] ?? null;

function numero(celda) {
  if (!celda || celda.v == null || celda.v === "") return null;
  if (typeof celda.v === "number") return celda.v;
  const n = Number(String(celda.v).replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function texto(celda) {
  if (!celda || celda.v == null) return null;
  const t = String(celda.v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

const pct = (v) => `${(v * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })}%`;
const entero = (v) => Number(v).toLocaleString("es-MX", { maximumFractionDigits: 0 });

/**
 * Cómo se lee cada indicador. La llave es el número del KPI.
 *
 *   agregado  cómo se junta el año:
 *             PROMEDIO   promedio de los meses
 *             RAZON      Σ numerador / Σ denominador
 *             PONDERADO  promedio pesado por `peso` (número de OT)
 *             ULTIMO     el último mes: el indicador ya es acumulado
 */
const REGLAS = {
  "01": { tipo: "CAPACIDAD", base: /^capacidad/, real: /^produccion/, agregado: "PROMEDIO" },
  "02": { tipo: "CAPACIDAD", base: /^tm$/, real: /^tm mtto/, agregado: "PROMEDIO" },
  "03": { tipo: "MATRIZ", agregado: "RAZON" },
  "04": { tipo: "RAZON", num: /ejecutadas/, den: /planeadas/, sufijo: " h", agregado: "RAZON" },
  "05": { tipo: "DIRECTO", col: /criticos/, agregado: "PROMEDIO" },
  "06": { tipo: "DIRECTO", col: /otros requisitos/, agregado: "PROMEDIO" },
  "07": { tipo: "TIEMPO", col: /^mttr/, agregado: "PONDERADO" },
  "08": { tipo: "TIEMPO", col: /^mtbf/, agregado: "PONDERADO" },
  "09": { tipo: "TIEMPO", col: /^mttr/, agregado: "PONDERADO" },
  "10": { tipo: "TIEMPO", col: /^mtbf/, agregado: "PONDERADO" },
  "11": { tipo: "PLAN_AIMS", den: "ANIO", agregado: "ULTIMO" },
  "12": { tipo: "PLAN_AIMS", den: /^total$/, agregado: "ULTIMO" },
};

/** '>=85%' → { meta: 0.85, sentido: 'MAYOR', unidad: '%' }; '<=60 MIN' → 60, MENOR, min. */
function interpretarMeta(celda) {
  if (!celda || celda.v == null || celda.v === "") {
    return { texto: null, meta: null, sentido: "MAYOR", unidad: "%" };
  }
  if (typeof celda.v === "number") {
    return { texto: pct(celda.v), meta: celda.v, sentido: "MAYOR", unidad: "%" };
  }
  const t = String(celda.v).trim();
  const unidad = /min/i.test(t) ? "min" : "%";
  const n = parseFloat(t.replace(/[^\d.,]/g, "").replace(",", "."));
  return {
    texto: t,
    meta: Number.isFinite(n) ? (unidad === "%" ? n / 100 : n) : null,
    sentido: /^\s*(<|≤)/.test(t) ? "MENOR" : "MAYOR",
    unidad,
  };
}

/** Lector de una hoja: celdas, ficha y la tabla mensual. */
function hojaDe(ws) {
  const rango = XLSX.utils.decode_range(ws["!ref"]);
  const celda = (c, r) => ws[XLSX.utils.encode_cell({ c, r })];

  // La ficha: etiquetas en la columna A, valor en la B
  const ficha = {};
  for (let r = rango.s.r; r <= Math.min(rango.e.r, 10); r++) {
    const etiqueta = normal(celda(0, r)?.v);
    if (etiqueta) ficha[etiqueta] = celda(1, r);
  }

  // La tabla: el renglón que trae "Mes". Sus columnas son el bloque contiguo
  // de encabezados; lo que sigue después de una columna vacía es la tabla
  // dinámica o los datos de apoyo, y no se mezcla.
  let filaEnc = -1;
  let colMes = -1;
  for (let r = rango.s.r; r <= Math.min(rango.e.r, 20) && filaEnc < 0; r++) {
    for (let c = 1; c <= 4; c++) {
      if (normal(celda(c, r)?.v) === "mes") {
        filaEnc = r;
        colMes = c;
        break;
      }
    }
  }

  const columnas = [];
  if (filaEnc >= 0) {
    for (let c = 1; c <= rango.e.c; c++) {
      const t = normal(celda(c, filaEnc)?.v);
      if (!t && c > colMes) break;
      columnas.push({ c, t });
    }
  }
  const col = (re, desde = colMes) =>
    columnas.find((x) => x.c > desde && (typeof re === "string" ? x.t === re : re.test(x.t)))?.c ?? -1;

  const renglones = [];
  if (filaEnc >= 0) {
    const colAnio = columnas.find((x) => /^a[nñ]o$/.test(x.t))?.c ?? colMes - 1;
    for (let r = filaEnc + 1; r <= rango.e.r; r++) {
      const mes = mesDe(celda(colMes, r)?.v);
      if (!mes) continue;
      renglones.push({
        r,
        mes,
        anio: numero(celda(colAnio, r)),
        ok: normal(celda(0, r)?.v) === "ok",
      });
    }
  }

  return { ws, rango, celda, ficha, filaEnc, columnas, col, renglones };
}

// =============================================
// REGLAS POR TIPO
// =============================================

/** KPI-01 y 02: varios renglones por mes (uno por BU) que se ponderan. */
function leerCapacidad(h, regla) {
  const cFamilia = h.col(/^familia/);
  const cBu = h.col(/^bu$/);
  const cBase = h.col(regla.base);
  const cReal = h.col(regla.real);
  const cPeso = h.col(/^% ?bu/);
  if ([cFamilia, cBase, cReal, cPeso].some((c) => c < 0)) {
    return { error: "no se encontraron las columnas de familia, base, real y % BU" };
  }

  const porMes = new Map();
  for (const x of h.renglones) {
    const k = `${x.anio}-${x.mes}`;
    if (!porMes.has(k)) porMes.set(k, { anio: x.anio, mes: x.mes, ok: false, filas: [] });
    const m = porMes.get(k);
    m.ok = m.ok || x.ok;
    m.filas.push({
      familia: texto(h.celda(cFamilia, x.r)),
      bu: texto(h.celda(cBu, x.r)),
      base: numero(h.celda(cBase, x.r)) || 0,
      real: numero(h.celda(cReal, x.r)) || 0,
      peso: numero(h.celda(cPeso, x.r)) || 0,
    });
  }

  const valores = [];
  for (const m of porMes.values()) {
    if (!m.ok) continue;
    // Igual que el libro: por familia, Σ (real / base) × peso de cada BU, y el
    // mes es el promedio de las familias (Inyección y Compuesto).
    const familias = {};
    const bus = {};
    for (const f of m.filas) {
      const uso = f.base ? f.real / f.base : 0;
      familias[f.familia] = (familias[f.familia] || 0) + uso * f.peso;
      if (f.bu) bus[f.bu] = uso;
    }
    const lista = Object.values(familias);
    const valor = lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null;
    valores.push({
      anio: m.anio,
      mes: m.mes,
      valor,
      detalle: {
        familias,
        bus,
        nota: Object.entries(familias).map(([k, v]) => `${k} ${pct(v)}`).join(" · "),
      },
    });
  }
  return { valores };
}

/**
 * KPI-03: matriz máquina × mes con "<Mes> Plan" y "<Mes>" (real), SI / NO.
 *
 * Solo cuenta lo planeado que se hizo. Los mantenimientos hechos sin estar en
 * el plan se informan aparte, pero no suben el porcentaje.
 */
function leerMatriz(h) {
  let filaMaq = -1;
  let colMaq = -1;
  for (let r = h.rango.s.r; r <= Math.min(h.rango.e.r, 10) && filaMaq < 0; r++) {
    for (let c = 0; c <= h.rango.e.c; c++) {
      if (normal(h.celda(c, r)?.v) === "maquina") {
        filaMaq = r;
        colMaq = c;
        break;
      }
    }
  }
  if (filaMaq < 0) return { error: 'no se encontró la matriz de "Máquina"' };

  const pares = {};
  for (let c = colMaq + 1; c <= h.rango.e.c; c++) {
    const t = normal(h.celda(c, filaMaq)?.v);
    const m = t.match(/^([a-z]+)( plan)?$/);
    const mes = m && mesDe(m[1]);
    if (!mes) continue;
    pares[mes] = pares[mes] || {};
    pares[mes][m[2] ? "plan" : "real"] = c;
  }

  const maquinas = [];
  for (let r = filaMaq + 1; r <= h.rango.e.r; r++) {
    const nombre = texto(h.celda(colMaq, r));
    if (!nombre || /cumplimiento|^si$|^no$/i.test(nombre)) break;
    maquinas.push({ r, nombre });
  }

  const si = (c, r) => c != null && normal(h.celda(c, r)?.v) === "si";
  const valores = [];
  for (const x of h.renglones) {
    if (!x.ok) continue;
    const p = pares[x.mes];
    if (!p) continue;
    const planeadas = maquinas.filter((q) => si(p.plan, q.r));
    const cumplidas = planeadas.filter((q) => si(p.real, q.r));
    const sinPlan = maquinas.filter((q) => !si(p.plan, q.r) && si(p.real, q.r));
    const faltantes = planeadas.filter((q) => !si(p.real, q.r)).map((q) => q.nombre);
    valores.push({
      anio: x.anio,
      mes: x.mes,
      valor: planeadas.length ? cumplidas.length / planeadas.length : null,
      numerador: cumplidas.length,
      denominador: planeadas.length,
      detalle: {
        faltantes,
        sinPlan: sinPlan.map((q) => q.nombre),
        nota:
          `${cumplidas.length} de ${planeadas.length} planeadas` +
          (sinPlan.length ? ` · ${sinPlan.length} sin estar en el plan` : ""),
      },
    });
  }
  return { valores, extra: { maquinas: maquinas.length } };
}

/** KPI-04: ejecutado / planeado. Sin plan en el mes no hay porcentaje. */
function leerRazon(h, regla) {
  const cNum = h.col(regla.num);
  const cDen = h.col(regla.den);
  if (cNum < 0 || cDen < 0) return { error: "no se encontraron las columnas de planeado y ejecutado" };

  const valores = [];
  for (const x of h.renglones) {
    if (!x.ok) continue;
    const num = numero(h.celda(cNum, x.r));
    const den = numero(h.celda(cDen, x.r));
    valores.push({
      anio: x.anio,
      mes: x.mes,
      valor: den ? (num || 0) / den : null,
      numerador: num,
      denominador: den,
      detalle: {
        nota: den ? `${entero(num || 0)} de ${entero(den)}${regla.sufijo || ""}` : "Sin plan en el mes",
      },
    });
  }
  return { valores };
}

/** KPI-05 y 06: el porcentaje viene capturado tal cual. */
function leerDirecto(h, regla) {
  const c = h.col(regla.col);
  if (c < 0) return { error: "no se encontró la columna del indicador" };
  const valores = [];
  for (const x of h.renglones) {
    if (!x.ok) continue;
    const v = numero(h.celda(c, x.r));
    valores.push({ anio: x.anio, mes: x.mes, valor: v, detalle: v == null ? { nota: "Pendiente de captura" } : {} });
  }
  return { valores };
}

/** KPI-07 a 10: MTTR / MTBF en minutos, con el número de OT como peso. */
function leerTiempo(h, regla) {
  const c = h.col(regla.col);
  const cOt = h.col(/^no\.? ?ot/);
  if (c < 0) return { error: "no se encontró la columna de minutos" };
  const valores = [];
  for (const x of h.renglones) {
    if (!x.ok) continue;
    const v = numero(h.celda(c, x.r));
    const ot = cOt >= 0 ? numero(h.celda(cOt, x.r)) : null;
    valores.push({
      anio: x.anio,
      mes: x.mes,
      valor: v,
      peso: ot,
      detalle: ot != null ? { nota: `${entero(ot)} OT` } : {},
    });
  }
  return { valores };
}

/**
 * KPI-11 y 12: puntos del plan AIMS. El porcentaje es ACUMULADO: puntos
 * cerrados (YES + N/A, como el libro) desde enero, entre el total del plan.
 * La 11 divide entre los puntos del año; la 12, entre el total 2026 + 2027.
 *
 * La columna "NO" del libro no se usa: su fórmula se vuelve negativa (−2) de
 * junio a agosto.
 */
function leerPlanAims(h, regla) {
  const cYes = h.col("yes");
  const cNa = h.col("n/a");
  const cProceso = h.col(/^en proceso/);
  if (cYes < 0 || cNa < 0) return { error: 'no se encontraron las columnas "YES" y "N/A"' };

  let cerrados = 0;
  let na = 0;
  const valores = [];
  for (const x of h.renglones) {
    const yes = numero(h.celda(cYes, x.r)) || 0;
    const n = numero(h.celda(cNa, x.r)) || 0;
    cerrados += yes + n;
    na += n;
    if (!x.ok) continue;

    const cDen = regla.den === "ANIO" ? h.col(String(x.anio)) : h.col(regla.den);
    const total = cDen >= 0 ? numero(h.celda(cDen, x.r)) : null;
    const proceso = cProceso >= 0 ? numero(h.celda(cProceso, x.r)) : null;
    valores.push({
      anio: x.anio,
      mes: x.mes,
      valor: total ? cerrados / total : null,
      numerador: cerrados,
      denominador: total,
      detalle: {
        cerradosMes: yes,
        enProceso: proceso,
        nota:
          `${entero(cerrados)} de ${total == null ? "—" : entero(total)} cerrados` +
          (na ? ` (${entero(na)} N/A)` : "") +
          (proceso ? ` · ${entero(proceso)} en proceso` : ""),
      },
    });
  }
  return { valores };
}

/** KPI-04 trae al lado la lista de cursos impartidos. */
function leerCursos(h) {
  for (let r = h.rango.s.r; r <= Math.min(h.rango.e.r, 6); r++) {
    for (let c = 0; c <= h.rango.e.c; c++) {
      if (!/^curso/.test(normal(h.celda(c, r)?.v))) continue;
      const cursos = [];
      for (let rr = r + 1; rr <= h.rango.e.r; rr++) {
        const curso = texto(h.celda(c, rr));
        if (!curso) break;
        cursos.push({
          mes: texto(h.celda(c - 1, rr)),
          curso,
          participantes: numero(h.celda(c + 1, rr)),
          horas: numero(h.celda(c + 2, rr)),
        });
      }
      return cursos;
    }
  }
  return null;
}

const LECTORES = {
  CAPACIDAD: leerCapacidad,
  MATRIZ: leerMatriz,
  RAZON: leerRazon,
  DIRECTO: leerDirecto,
  TIEMPO: leerTiempo,
  PLAN_AIMS: leerPlanAims,
};

/**
 * Lee todas las hojas 'AIMS-KPI-NN' del libro.
 *
 * Una hoja sin regla (un KPI-13 que agreguen después) se guarda con su ficha y
 * sin valores, y queda un aviso: así aparece en el reporte y se nota que falta.
 *
 * @returns {Object} { kpis, avisos }
 */
function parsearAims(contenido) {
  const libro = XLSX.read(contenido, { type: "buffer" });
  const hojas = libro.SheetNames.filter((n) => /^aims-kpi-\d+$/i.test(n.trim()));
  if (hojas.length === 0) {
    throw new Error(
      `El libro no tiene hojas "AIMS-KPI-NN". Hojas: ${libro.SheetNames.join(", ")}.`,
    );
  }

  const kpis = [];
  const avisos = [];
  for (const nombreHoja of hojas) {
    const h = hojaDe(libro.Sheets[nombreHoja]);
    const numeroKpi = nombreHoja.match(/(\d+)\s*$/)[1].padStart(2, "0");
    const codigo = texto(h.ficha["no. kpi"]) || `AIMS-KPI-${numeroKpi}`;
    const meta = interpretarMeta(h.ficha.target);
    const regla = REGLAS[numeroKpi];

    let leido = { valores: [] };
    if (!regla) {
      avisos.push(`${codigo}: no hay regla para leer esta hoja; se muestra solo su ficha.`);
    } else if (h.filaEnc < 0) {
      avisos.push(`${codigo}: no se encontró la tabla mensual (encabezado "Mes").`);
    } else {
      leido = LECTORES[regla.tipo](h, regla);
      if (leido.error) {
        avisos.push(`${codigo}: ${leido.error}; se muestra solo su ficha.`);
        leido = { valores: [] };
      }
    }

    const extra = { ...(leido.extra || {}) };
    const cursos = leerCursos(h);
    if (cursos?.length) extra.cursos = cursos;

    kpis.push({
      codigo,
      orden: Number(numeroKpi),
      nombre: texto(h.ficha.kpi),
      definicion: texto(h.ficha.definicion),
      calculo: texto(h.ficha.calculo),
      meta_texto: meta.texto,
      meta: meta.meta,
      sentido: meta.sentido,
      unidad: meta.unidad,
      fuente: texto(h.ficha.fuente),
      agregado: regla?.agregado || "PROMEDIO",
      extra: Object.keys(extra).length ? extra : null,
      valores: leido.valores.filter((v) => v.anio && v.mes),
    });
  }

  return { kpis: kpis.sort((a, b) => a.orden - b.orden), avisos };
}

module.exports = { parsearAims, interpretarMeta };
