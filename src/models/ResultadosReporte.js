const db = require("../config/database");

/**
 * Consultas del reporte de Resultados.
 *
 * Sustituye el libro 'DATA-FCMX-AAAA Mes.xlsx' completo: catorce hojas y diez
 * gráficas de barras agrupadas comparando cinco años mes a mes.
 *
 * Aquí se guardan SOLO los absolutos y todas las razones se calculan al
 * consultar. Eso permite dos cosas que el Excel no da:
 *
 *   Agregar por año, trimestre o lo que sea sin que el porcentaje salga mal.
 *   Un %scrap anual no es el promedio de los doce %scrap mensuales: es el
 *   total de rechazo entre el total producido. Con los absolutos guardados,
 *   sale bien solo.
 *
 *   Cruzar hojas. El precio por unidad —facturación USD entre unidades— vive
 *   en dos hojas distintas del libro y por eso nadie lo grafica, aunque es de
 *   lo más revelador que hay aquí: Crocs pasó de 3.56 USD por par en 2020 a
 *   4.48 en 2026.
 */

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const MESES_CORTO = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

/** Unidades de negocio que se facturan y se producen (sin PLANTA ni FOOTWEAR). */
const BUS_OPERATIVAS = ["CROCS", "FOAM_DESIGN", "SUELA", "DUAL_COLOR"];

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** División que no revienta ni devuelve infinito cuando el divisor es cero. */
const razon = (a, b) => (a === null || !b ? null : Number(a) / Number(b));

/**
 * Trae valores y los devuelve indexados por mes y métrica.
 *
 * @returns {Map<string, number>}  llave 'mes|bu|metrica'
 */
async function traer(anio, metricas, bus) {
  const params = [anio, metricas];
  let filtroBu = "";
  if (bus) {
    params.push(bus);
    filtroBu = `AND bu = ANY($${params.length})`;
  }
  const { rows } = await db.query(
    `SELECT mes, bu, metrica_codigo, valor::float AS valor
       FROM res_valores
      WHERE anio = $1 AND metrica_codigo = ANY($2) ${filtroBu}`,
    params,
  );
  const mapa = new Map();
  for (const r of rows) mapa.set(`${r.mes}|${r.bu}|${r.metrica_codigo}`, r.valor);
  return mapa;
}

/** Los doce meses, con etiqueta, listos para ser el eje de una gráfica. */
const ejeMeses = () =>
  Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    etiqueta: MESES[i],
    eje: MESES_CORTO[i],
  }));

/** Quita del eje los meses del final que no tienen ningún dato. */
function recortarVacios(serie, llaves) {
  let ultimo = -1;
  serie.forEach((f, i) => {
    if (llaves.some((k) => f[k] !== null && f[k] !== undefined)) ultimo = i;
  });
  return ultimo < 0 ? [] : serie.slice(0, ultimo + 1);
}

// =============================================
// BLOQUES
// =============================================

/**
 * Facturación: unidades, dólares y el precio por unidad que sale de dividirlas.
 */
async function facturacion(anio) {
  const mapa = await traer(anio, ["fact_qty", "fact_usd"], BUS_OPERATIVAS);

  const serie = ejeMeses().map((m) => {
    const fila = { ...m };
    let qty = 0;
    let usd = 0;
    let hay = false;
    for (const bu of BUS_OPERATIVAS) {
      const q = mapa.get(`${m.mes}|${bu}|fact_qty`) ?? null;
      const u = mapa.get(`${m.mes}|${bu}|fact_usd`) ?? null;
      fila[`qty_${bu}`] = q;
      fila[`usd_${bu}`] = u;
      fila[`precio_${bu}`] = razon(u, q);
      if (q !== null) { qty += q; hay = true; }
      if (u !== null) usd += u;
    }
    fila.qtyTotal = hay ? qty : null;
    fila.usdTotal = hay ? usd : null;
    fila.precio = razon(fila.usdTotal, fila.qtyTotal);
    return fila;
  });

  const porBu = BUS_OPERATIVAS.map((bu) => {
    let qty = 0;
    let usd = 0;
    for (let mes = 1; mes <= 12; mes++) {
      qty += mapa.get(`${mes}|${bu}|fact_qty`) ?? 0;
      usd += mapa.get(`${mes}|${bu}|fact_usd`) ?? 0;
    }
    return { bu, qty, usd, precio: razon(usd, qty) };
  });

  const totalQty = porBu.reduce((a, b) => a + b.qty, 0);
  const totalUsd = porBu.reduce((a, b) => a + b.usd, 0);
  for (const f of porBu) {
    f.pctQty = razon(f.qty, totalQty);
    f.pctUsd = razon(f.usd, totalUsd);
  }

  return {
    serie: recortarVacios(serie, ["qtyTotal"]),
    porBu,
    total: { qty: totalQty, usd: totalUsd, precio: razon(totalUsd, totalQty) },
  };
}

/**
 * Scrap por unidad de negocio.
 *
 * El total NO se lee de la hoja 'TOTAL SCRAP': se suma de las cuatro unidades,
 * que es exactamente lo mismo y no puede descuadrarse.
 */
async function scrap(anio) {
  const mapa = await traer(anio, ["scrap_producido", "scrap_rechazo"], BUS_OPERATIVAS);

  const serie = ejeMeses().map((m) => {
    const fila = { ...m };
    let prod = 0;
    let rech = 0;
    let hay = false;
    for (const bu of BUS_OPERATIVAS) {
      const p = mapa.get(`${m.mes}|${bu}|scrap_producido`) ?? null;
      const r = mapa.get(`${m.mes}|${bu}|scrap_rechazo`) ?? null;
      fila[`pct_${bu}`] = razon(r, p);
      if (p !== null) { prod += p; hay = true; }
      if (r !== null) rech += r;
    }
    fila.producido = hay ? prod : null;
    fila.rechazo = hay ? rech : null;
    fila.pctTotal = razon(fila.rechazo, fila.producido);
    return fila;
  });

  // El mapa de calor: una celda por unidad de negocio y mes. Sustituye de un
  // golpe las cinco hojas de scrap del libro, que hay que leer por separado.
  const celdas = [];
  for (const bu of BUS_OPERATIVAS) {
    for (let mes = 1; mes <= 12; mes++) {
      const p = mapa.get(`${mes}|${bu}|scrap_producido`) ?? null;
      const r = mapa.get(`${mes}|${bu}|scrap_rechazo`) ?? null;
      if (p === null && r === null) continue;
      celdas.push({ bu, mes, etiqueta: MESES_CORTO[mes - 1], producido: p, rechazo: r, pct: razon(r, p) });
    }
  }

  const porBu = BUS_OPERATIVAS.map((bu) => {
    let p = 0;
    let r = 0;
    for (let mes = 1; mes <= 12; mes++) {
      p += mapa.get(`${mes}|${bu}|scrap_producido`) ?? 0;
      r += mapa.get(`${mes}|${bu}|scrap_rechazo`) ?? 0;
    }
    return { bu, producido: p, rechazo: r, neto: p - r, pct: razon(r, p) };
  });

  const prod = porBu.reduce((a, b) => a + b.producido, 0);
  const rech = porBu.reduce((a, b) => a + b.rechazo, 0);

  return {
    serie: recortarVacios(serie, ["producido"]),
    celdas,
    porBu,
    total: { producido: prod, rechazo: rech, neto: prod - rech, pct: razon(rech, prod) },
  };
}

/** Capacidad instalada contra comprometida, y el % de uso que sale de las dos. */
async function capacidad(anio) {
  const bus = ["CROCS", "SUELA", "FOAM_DESIGN", "DUAL_COLOR", "COMPOUND"];
  const mapa = await traer(
    anio,
    ["cap_instalada", "cap_comprometida", "cap_dias_habiles"],
    [...bus, "PLANTA"],
  );

  const serie = ejeMeses().map((m) => {
    const fila = { ...m, dias: mapa.get(`${m.mes}|PLANTA|cap_dias_habiles`) ?? null };
    let hay = false;
    for (const bu of bus) {
      const inst = mapa.get(`${m.mes}|${bu}|cap_instalada`) ?? null;
      const comp = mapa.get(`${m.mes}|${bu}|cap_comprometida`) ?? null;
      fila[`comp_${bu}`] = comp;
      fila[`inst_${bu}`] = inst;
      fila[`uso_${bu}`] = razon(comp, inst);
      if (comp) hay = true;
    }
    return hay ? fila : { ...fila, vacio: true };
  });

  const porBu = bus.map((bu) => {
    let comp = 0;
    let inst = 0;
    let n = 0;
    for (let mes = 1; mes <= 12; mes++) {
      const c = mapa.get(`${mes}|${bu}|cap_comprometida`);
      const i = mapa.get(`${mes}|${bu}|cap_instalada`);
      if (!c) continue;
      comp += c;
      inst += i ?? 0;
      n++;
    }
    return {
      bu,
      // Promedios, no sumas: es capacidad diaria y sumar doce meses de un
      // ritmo diario no significa nada
      comprometida: n ? comp / n : null,
      instalada: n ? inst / n : null,
      pctUso: razon(comp, inst),
      meses: n,
    };
  });

  return { serie: serie.filter((f) => !f.vacio), porBu };
}

/**
 * Personal: plantilla, rotación, horas extra y tiempo de ciclo.
 *
 * El tiempo de ciclo es el indicador que mejor resume el año y el libro lo
 * calcula en una columna escondida: minutos pagados entre unidades buenas.
 */
async function personal(anio) {
  const mapa = await traer(
    anio,
    ["hr_empleados", "hr_rotacion", "hr_horas_trabajadas", "hr_horas_estandar",
      "hr_horas_extra", "hr_horas_pagadas", "hr_qty_producida", "hr_qty_buena"],
    ["PLANTA"],
  );
  const g = (mes, m) => mapa.get(`${mes}|PLANTA|${m}`) ?? null;

  const serie = ejeMeses().map((m) => {
    const pagadas = g(m.mes, "hr_horas_pagadas");
    const buenas = g(m.mes, "hr_qty_buena");
    const trabajadas = g(m.mes, "hr_horas_trabajadas");
    const extra = g(m.mes, "hr_horas_extra");
    return {
      ...m,
      empleados: g(m.mes, "hr_empleados"),
      rotacion: g(m.mes, "hr_rotacion"),
      horasTrabajadas: trabajadas,
      horasExtra: extra,
      horasPagadas: pagadas,
      producidas: g(m.mes, "hr_qty_producida"),
      buenas,
      pctExtra: razon(extra, trabajadas),
      // Minutos de mano de obra por unidad buena
      ciclo: buenas ? razon(pagadas * 60, buenas) : null,
    };
  });

  const activos = serie.filter((f) => f.empleados !== null || f.horasPagadas !== null);
  const suma = (k) => activos.reduce((a, f) => a + (f[k] ?? 0), 0);
  const conDato = (k) => activos.filter((f) => f[k] !== null);
  const promedio = (k) => {
    const c = conDato(k);
    return c.length ? c.reduce((a, f) => a + f[k], 0) / c.length : null;
  };

  return {
    serie: activos,
    resumen: {
      empleados: promedio("empleados"),
      rotacion: promedio("rotacion"),
      horasTrabajadas: suma("horasTrabajadas"),
      horasExtra: suma("horasExtra"),
      horasPagadas: suma("horasPagadas"),
      buenas: suma("buenas"),
      pctExtra: razon(suma("horasExtra"), suma("horasTrabajadas")),
      ciclo: razon(suma("horasPagadas") * 60, suma("buenas")),
    },
  };
}

/** Energía: consumo, importe y su costo por unidad producida. */
async function energia(anio) {
  const mapa = await traer(anio, ["ene_kwh", "ene_eur", "hr_qty_buena"], ["PLANTA"]);
  const g = (mes, m) => mapa.get(`${mes}|PLANTA|${m}`) ?? null;

  const serie = ejeMeses().map((m) => {
    const kwh = g(m.mes, "ene_kwh");
    const eur = g(m.mes, "ene_eur");
    const buenas = g(m.mes, "hr_qty_buena");
    return {
      ...m,
      kwh,
      eur,
      eurKwh: razon(eur, kwh),
      kwhUnidad: razon(kwh, buenas),
      eurUnidad: razon(eur, buenas),
    };
  }).filter((f) => f.kwh !== null);

  const suma = (k) => serie.reduce((a, f) => a + (f[k] ?? 0), 0);
  const buenas = serie.reduce(
    (a, f) => a + (mapa.get(`${f.mes}|PLANTA|hr_qty_buena`) ?? 0), 0,
  );

  return {
    serie,
    resumen: {
      kwh: suma("kwh"),
      eur: suma("eur"),
      eurKwh: razon(suma("eur"), suma("kwh")),
      kwhUnidad: razon(suma("kwh"), buenas),
      eurUnidad: razon(suma("eur"), buenas),
    },
  };
}

/** Compound: toneladas producidas, recuperadas y desechadas. */
async function compound(anio) {
  const mapa = await traer(
    anio,
    ["comp_producido", "comp_polvo", "comp_purga", "comp_scrap", "comp_fee_mxn"],
    ["PLANTA"],
  );
  const g = (mes, m) => mapa.get(`${mes}|PLANTA|${m}`) ?? null;

  const serie = ejeMeses().map((m) => {
    const prod = g(m.mes, "comp_producido");
    const polvo = g(m.mes, "comp_polvo");
    const purga = g(m.mes, "comp_purga");
    const scr = g(m.mes, "comp_scrap");
    const reciclado = polvo === null && purga === null ? null : (polvo ?? 0) + (purga ?? 0);
    return {
      ...m,
      producido: prod,
      polvo,
      purga,
      reciclado,
      scrap: scr,
      fee: g(m.mes, "comp_fee_mxn"),
      pctScrap: razon(scr, prod),
      pctReciclado: razon(reciclado, prod),
    };
  }).filter((f) => f.producido !== null);

  const suma = (k) => serie.reduce((a, f) => a + (f[k] ?? 0), 0);

  return {
    serie,
    resumen: {
      producido: suma("producido"),
      reciclado: suma("reciclado"),
      scrap: suma("scrap"),
      fee: suma("fee"),
      pctScrap: razon(suma("scrap"), suma("producido")),
      pctReciclado: razon(suma("reciclado"), suma("producido")),
    },
  };
}

/**
 * Estado de resultados por unidad de negocio, y su cascada hasta el EBIT.
 *
 * El orden de la cascada NO es el de la hoja. 'Variable costs' ya incluye la
 * mano de obra directa, y el margen ENI se calcula antes de restarla, así que
 * la cascada baja por los cuatro conceptos sin mano de obra y solo después le
 * quita la mano de obra directa. Comprobado al céntimo contra Crocs.
 */
async function margen(anio) {
  const { rows: metricas } = await db.query(
    `SELECT codigo, nombre, signo, orden
       FROM res_metricas WHERE bloque = 'MARGEN' AND activo ORDER BY orden`,
  );

  const { rows } = await db.query(
    `SELECT v.bu, u.nombre AS bu_nombre, v.metrica_codigo, v.valor::float AS valor
       FROM res_valores v
       JOIN res_unidades_negocio u ON u.codigo = v.bu
       JOIN res_metricas m ON m.codigo = v.metrica_codigo
      WHERE v.anio = $1 AND v.mes = 0 AND m.bloque = 'MARGEN'
      ORDER BY u.orden`,
    [anio],
  );
  if (rows.length === 0) return null;

  const bus = [];
  const porBu = new Map();
  for (const r of rows) {
    if (!porBu.has(r.bu)) {
      porBu.set(r.bu, {});
      bus.push({ codigo: r.bu, nombre: r.bu_nombre });
    }
    porBu.get(r.bu)[r.metrica_codigo] = r.valor;
  }

  // Tabla: un renglón por concepto, una columna por unidad de negocio, más el
  // total y el % sobre ventas.
  //
  // Compound queda FUERA del total de unidades vendidas: se mide en toneladas
  // y sumar 300 toneladas a 4.7 millones de pares no significa nada. En los
  // importes sí entra, porque los euros sí se suman. El propio Excel hace lo
  // mismo: su celda de total de cantidad es =D5+H5+L5, sin la de Compound.
  const NO_SUMAN_CANTIDAD = new Set(["COMPOUND"]);

  const conceptos = metricas.map((m) => {
    const fila = { codigo: m.codigo, nombre: m.nombre, signo: m.signo, valores: {} };
    const esCantidad = m.codigo === "mg_qty_vendida";
    let total = 0;
    for (const bu of bus) {
      const v = porBu.get(bu.codigo)[m.codigo] ?? null;
      fila.valores[bu.codigo] = v;
      if (esCantidad && NO_SUMAN_CANTIDAD.has(bu.codigo)) continue;
      total += v ?? 0;
    }
    fila.total = total;
    return fila;
  });

  const ventasTotales = conceptos.find((c) => c.codigo === "mg_ventas")?.total || 0;
  const qtyTotal = conceptos.find((c) => c.codigo === "mg_qty_vendida")?.total || 0;
  for (const c of conceptos) {
    if (c.codigo === "mg_qty_vendida") continue;
    c.pctVentas = razon(c.total, ventasTotales);
    c.porUnidad = razon(c.total, qtyTotal);
  }

  // Cascada: los subtotales (signo 0) se dibujan desde cero y el resto como
  // escalones que parten del acumulado anterior.
  //
  // Servicios, transportes y comisiones van JUNTOS en un solo escalón. Sueltos
  // valen 4.8%, 1.8% y 1.0% de las ventas, y contra un eje de 22 millones
  // quedan en rebanadas de dos píxeles que no se pueden ni mirar. Sumados dan
  // 7.5% y se leen. Materia prima NO se agrupa: es el 39.9% y es la cifra que
  // hay que ver. El desglose completo sigue en la tabla de abajo.
  const AGRUPADOS = {
    codigo: "__otros_variables",
    nombre: "Otros costos variables",
    partes: ["mg_utilities", "mg_transportes", "mg_comisiones"],
  };

  const PASOS = [
    "mg_ventas", "mg_materia_prima", AGRUPADOS.codigo, "mg_margen_eni",
    "mg_mano_obra_directa", "mg_margen_finproject", "mg_costos_fijos",
    "mg_ebitda", "mg_depreciacion", "mg_ebit",
  ];
  const porCodigo = new Map(conceptos.map((c) => [c.codigo, c]));

  // El escalón agrupado se arma aquí y se comporta como cualquier otro
  const partes = AGRUPADOS.partes
    .map((cod) => porCodigo.get(cod))
    .filter(Boolean);
  if (partes.length) {
    porCodigo.set(AGRUPADOS.codigo, {
      codigo: AGRUPADOS.codigo,
      nombre: AGRUPADOS.nombre,
      signo: -1,
      total: partes.reduce((acc, c) => acc + c.total, 0),
      pctVentas: razon(partes.reduce((acc, c) => acc + c.total, 0), ventasTotales),
      // Para que el tooltip pueda abrirlo sin ir a buscar a otro lado
      detalle: partes.map((c) => ({ nombre: c.nombre, total: c.total, pctVentas: c.pctVentas })),
    });
  }

  let acumulado = 0;
  const cascada = [];
  for (const codigo of PASOS) {
    const c = porCodigo.get(codigo);
    if (!c) continue;
    const esSubtotal = c.signo === 0;
    if (esSubtotal) {
      // El subtotal debe empatar con lo acumulado; si no, es que la hoja
      // cambió y más vale que se note
      cascada.push({
        codigo, nombre: c.nombre, tipo: "subtotal",
        base: 0, delta: c.total, desde: 0, hasta: c.total,
        descuadre: Math.abs(c.total - acumulado) > 1 ? c.total - acumulado : null,
        pctVentas: c.pctVentas,
      });
      acumulado = c.total;
    } else {
      const delta = c.signo * c.total;
      cascada.push({
        codigo, nombre: c.nombre, tipo: c.signo > 0 ? "suma" : "resta",
        base: Math.min(acumulado, acumulado + delta),
        delta, desde: acumulado, hasta: acumulado + delta,
        pctVentas: c.pctVentas,
        detalle: c.detalle || null,
      });
      acumulado += delta;
    }
  }

  return { bus, conceptos, cascada, ventasTotales, qtyTotal };
}

/** La foto de carga de PO que vive arriba de la hoja de capacidad. */
async function carga(anio) {
  const { rows } = await db.query(
    `SELECT v.bu, u.nombre AS bu_nombre, v.metrica_codigo, v.valor::float AS valor
       FROM res_valores v
       JOIN res_unidades_negocio u ON u.codigo = v.bu
      WHERE v.anio = $1 AND v.mes = 0 AND v.metrica_codigo IN ('carga_po_qty', 'carga_po_dias')
      ORDER BY u.orden`,
    [anio],
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.bu)) mapa.set(r.bu, { bu: r.bu, nombre: r.bu_nombre });
    mapa.get(r.bu)[r.metrica_codigo === "carga_po_qty" ? "qty" : "dias"] = r.valor;
  }
  return [...mapa.values()];
}

// =============================================
// API
// =============================================

const ResultadosReporte = {
  /** Años con dato, unidades de negocio y el último corte cargado. */
  async getFiltros() {
    const [anios, bus, corte] = await Promise.all([
      db.query(
        `SELECT anio, COUNT(*)::int AS valores
           FROM res_valores GROUP BY 1 ORDER BY 1 DESC`,
      ),
      db.query(
        `SELECT codigo, nombre, medida FROM res_unidades_negocio
          WHERE activo ORDER BY orden`,
      ),
      db.query(
        `SELECT corte_anio, corte_mes, semana_carga, archivo,
                to_char(creado_en, 'YYYY-MM-DD HH24:MI') AS creado_texto
           FROM res_cargas ORDER BY creado_en DESC LIMIT 1`,
      ),
    ]);

    return {
      anios: anios.rows.map((r) => ({ anio: Number(r.anio), valores: r.valores })),
      bus: bus.rows,
      meses: MESES.map((nombre, i) => ({ numero: i + 1, nombre })),
      ultimaCarga: corte.rows[0] || null,
    };
  },

  /** Todo el tablero de un año, en una sola llamada. */
  async getDashboard(anio) {
    const [fact, scr, cap, per, ene, comp, mar, car] = await Promise.all([
      facturacion(anio), scrap(anio), capacidad(anio), personal(anio),
      energia(anio), compound(anio), margen(anio), carga(anio),
    ]);
    return {
      anio: Number(anio),
      facturacion: fact,
      scrap: scr,
      capacidad: cap,
      personal: per,
      energia: ene,
      compound: comp,
      margen: mar,
      carga: car,
    };
  },

  /**
   * Los doce meses con una columna por año, que es LA gráfica del libro: las
   * de 'Q.TY (Billed)' y 'USD (Billed)' comparan cinco años mes a mes con
   * barras agrupadas, y las de scrap hacen lo mismo con el porcentaje.
   *
   * Las razones se arman desde los absolutos de cada mes, no promediando
   * porcentajes: el %scrap de marzo es el rechazo de marzo entre lo producido
   * en marzo, sumando las cuatro unidades de negocio.
   *
   * @param {String} serie  qty | usd | precio | scrap
   */
  async getComparativoMensual(serie = "qty") {
    const METRICAS = {
      qty: ["fact_qty"],
      usd: ["fact_usd"],
      precio: ["fact_usd", "fact_qty"],
      scrap: ["scrap_rechazo", "scrap_producido"],
    };
    const metricas = METRICAS[serie];
    if (!metricas) throw new Error(`Serie desconocida: ${serie}`);

    const { rows } = await db.query(
      `SELECT anio, mes, metrica_codigo, SUM(valor)::float AS total
         FROM res_valores
        WHERE mes BETWEEN 1 AND 12
          AND metrica_codigo = ANY($1)
          AND bu = ANY($2)
        GROUP BY 1, 2, 3`,
      [metricas, BUS_OPERATIVAS],
    );

    const porAnioMes = new Map();
    for (const r of rows) {
      const k = `${r.anio}|${r.mes}`;
      if (!porAnioMes.has(k)) porAnioMes.set(k, {});
      porAnioMes.get(k)[r.metrica_codigo] = r.total;
    }

    const anios = [...new Set(rows.map((r) => Number(r.anio)))].sort();

    const filas = ejeMeses().map((m) => {
      const fila = { ...m };
      for (const anio of anios) {
        const v = porAnioMes.get(`${anio}|${m.mes}`);
        if (!v) { fila[anio] = null; continue; }
        if (serie === "qty") fila[anio] = v.fact_qty ?? null;
        else if (serie === "usd") fila[anio] = v.fact_usd ?? null;
        else if (serie === "precio") fila[anio] = razon(v.fact_usd, v.fact_qty);
        else fila[anio] = razon(v.scrap_rechazo, v.scrap_producido);
      }
      return fila;
    });

    return { serie, anios, filas };
  },

  /**
   * Un renglón por año, para las gráficas que comparan la historia completa.
   *
   * Todo sale de los absolutos, así que los porcentajes anuales son correctos:
   * el %scrap del año es el rechazo total entre lo producido total, no el
   * promedio de los doce porcentajes mensuales, que daría otro número.
   */
  async getHistorico() {
    const { rows } = await db.query(
      `WITH base AS (
         SELECT anio, bu, metrica_codigo, SUM(valor)::float AS total
           FROM res_valores
          WHERE mes BETWEEN 1 AND 12
          GROUP BY 1, 2, 3
       )
       SELECT anio, bu, metrica_codigo, total FROM base ORDER BY anio`,
    );

    const porAnio = new Map();
    for (const r of rows) {
      if (!porAnio.has(r.anio)) porAnio.set(r.anio, { anio: Number(r.anio), bu: {} });
      const a = porAnio.get(r.anio);
      (a.bu[r.bu] ||= {})[r.metrica_codigo] = r.total;
    }

    const anios = [...porAnio.values()].sort((a, b) => a.anio - b.anio);

    // El estado de resultados es anual (mes 0) y no entra en la suma de arriba
    const { rows: mg } = await db.query(
      `SELECT anio, metrica_codigo, SUM(valor)::float AS total
         FROM res_valores
        WHERE mes = 0 AND metrica_codigo IN ('mg_ventas', 'mg_ebitda', 'mg_ebit')
        GROUP BY 1, 2`,
    );
    const mgPorAnio = new Map();
    for (const r of mg) {
      if (!mgPorAnio.has(r.anio)) mgPorAnio.set(r.anio, {});
      mgPorAnio.get(r.anio)[r.metrica_codigo] = r.total;
    }

    return anios.map((a) => {
      const suma = (metrica, bus = BUS_OPERATIVAS) =>
        bus.reduce((acc, bu) => acc + (a.bu[bu]?.[metrica] ?? 0), 0);
      const planta = (metrica) => a.bu.PLANTA?.[metrica] ?? null;

      const qty = suma("fact_qty");
      const usd = suma("fact_usd");
      const prod = suma("scrap_producido");
      const rech = suma("scrap_rechazo");
      const buenas = planta("hr_qty_buena");
      const m = mgPorAnio.get(a.anio) || {};

      const fila = {
        anio: a.anio,
        qty, usd,
        precio: razon(usd, qty),
        producido: prod,
        rechazo: rech,
        pctScrap: razon(rech, prod),
        kwh: planta("ene_kwh"),
        eur: planta("ene_eur"),
        kwhUnidad: razon(planta("ene_kwh"), buenas),
        eurKwh: razon(planta("ene_eur"), planta("ene_kwh")),
        horasPagadas: planta("hr_horas_pagadas"),
        buenas,
        ciclo: razon((planta("hr_horas_pagadas") ?? 0) * 60, buenas),
        pctExtra: razon(planta("hr_horas_extra"), planta("hr_horas_trabajadas")),
        compProducido: planta("comp_producido"),
        ventas: m.mg_ventas ?? null,
        ebitda: m.mg_ebitda ?? null,
        ebit: m.mg_ebit ?? null,
      };

      // Precio y %scrap por unidad de negocio, para las gráficas por BU
      for (const bu of BUS_OPERATIVAS) {
        fila[`precio_${bu}`] = razon(a.bu[bu]?.fact_usd, a.bu[bu]?.fact_qty);
        fila[`pct_${bu}`] = razon(a.bu[bu]?.scrap_rechazo, a.bu[bu]?.scrap_producido);
        fila[`qty_${bu}`] = a.bu[bu]?.fact_qty ?? null;
      }
      return fila;
    });
  },
};

module.exports = ResultadosReporte;
module.exports.MESES = MESES;
module.exports.BUS_OPERATIVAS = BUS_OPERATIVAS;
