const XLSX = require("xlsx");

/**
 * Lector del libro de CAPEX ('estratto MEX_piano FNJ PS 2025-2028 Rev NN').
 *
 * La hoja 'Capex update 2025-2026' trae varios bloques uno debajo de otro
 * (CAPEX 2025, CAPEX 2026, CAPEX 2027), cada uno con su encabezado y su renglón
 * de TOT. Se lee SOLO el bloque configurado, de su encabezado a su TOT.
 *
 * ---------------------------------------------------------------------------
 * EL AVANCE ESTÁ EN EL COLOR, NO EN EL TEXTO
 * ---------------------------------------------------------------------------
 * Las etapas (Relación técnica … Firmas FOAM, Firmas ITALIA) casi nunca tienen
 * texto: el área pinta la celda. Verde es "terminado", amarillo "en proceso",
 * blanco "sin empezar" y gris parece "cancelado / no aplica". Así que aquí se
 * lee el relleno de cada celda. Lo que el reporte usa hoy es solo el verde de
 * Firmas FOAM: es el final del proceso interno y el área aclaró que el resto
 * del avance no está al día.
 *
 * El verde se reconoce por tono y no por un código exacto, para que un verde
 * un poco distinto (el de la paleta estándar, uno más claro) cuente igual.
 *
 * ---------------------------------------------------------------------------
 * LOS RENGLONES OCULTOS NO SE LEEN
 * ---------------------------------------------------------------------------
 * El área oculta los proyectos que ya no quiere ver. El TOT. del libro sí los
 * suma, pero el reporte respeta lo que el área decidió esconder.
 *
 * ---------------------------------------------------------------------------
 * LAS COLUMNAS SE ENCUENTRAN POR SU ENCABEZADO
 * ---------------------------------------------------------------------------
 * No por su letra: el libro va por la Rev 04 y entre revisiones se insertan
 * columnas. Si falta un encabezado indispensable se dice cuál, en vez de leer
 * la columna equivocada en silencio.
 */

/** Sin acentos, sin espacios dobles, en minúsculas: para comparar encabezados. */
const normal = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Las etapas en el orden del libro. `clave` es como se guarda. */
const ETAPAS = [
  { clave: "relacion_tecnica", nombre: "Relación técnica", busca: /^relacion tecnica/ },
  { clave: "cotizacion", nombre: "Cotización", busca: /^cotizacion/ },
  { clave: "rac", nombre: "RAC", busca: /^rac\b/ },
  { clave: "layout", nombre: "Lay out", busca: /^lay ?out/ },
  { clave: "hse", nombre: "Doc. HSE", busca: /^doc\.? ?hse/ },
  { clave: "firmas_foam", nombre: "Firmas FOAM", busca: /^firmas foam/ },
  { clave: "firmas_italia", nombre: "Firmas ITALIA", busca: /^firmas italia/ },
];

/**
 * Qué dice el relleno de una celda.
 *
 * @returns {String} VERDE | AMARILLO | GRIS | SIN | OTRO
 */
function estadoDeRelleno(celda) {
  const s = celda?.s;
  if (!s || s.patternType !== "solid" || !s.fgColor) return "SIN";
  const { rgb, theme, tint = 0 } = s.fgColor;

  if (rgb) {
    const hex = String(rgb).slice(-6);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (g > r + 25 && g > b + 25) return "VERDE";
    if (r > 200 && g > 180 && b < 150) return "AMARILLO";
    if (Math.abs(r - g) < 16 && Math.abs(g - b) < 16) return r > 245 ? "SIN" : "GRIS";
    return "OTRO";
  }

  // Colores del tema. El 0 es el fondo (blanco); oscurecido es el gris que
  // usa el libro para lo cancelado. El 1 es el texto (negro); aclarado, gris.
  if (theme === 0) return tint < -0.05 ? "GRIS" : "SIN";
  if (theme === 1) return tint > 0.3 ? "GRIS" : "OTRO";
  return "OTRO";
}

/** Número o null. Los textos como 'HSE' u 'OPEX' en la columna de monto no son montos. */
function numero(celda) {
  if (!celda || celda.v == null || celda.v === "") return null;
  if (typeof celda.v === "number") return celda.v;
  const n = Number(String(celda.v).replace(/[€$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function texto(celda) {
  if (!celda || celda.v == null) return null;
  const t = String(celda.v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** Lee el libro una vez, con estilos: lo comparten los dos lectores. */
const leerLibro = (contenido) =>
  Buffer.isBuffer(contenido)
    ? XLSX.read(contenido, { type: "buffer", cellStyles: true })
    : contenido;

/** La hoja por su nombre, tolerando mayúsculas y espacios. */
function buscarHoja(libro, hoja) {
  return (
    libro.SheetNames.find((n) => n === hoja) ||
    libro.SheetNames.find((n) => normal(n) === normal(hoja)) ||
    null
  );
}

/**
 * Lee el bloque de un libro.
 *
 * @param {Buffer|Object} contenido  el archivo, o el libro ya leído
 * @param {Object} opciones { hoja: 'Capex update 2025-2026', bloque: 'CAPEX 2026' }
 * @returns {Object} { filas, avisos, hoja, bloque, renglonEncabezado, ocultos }
 */
function parsearCapex(contenido, { hoja, bloque }) {
  const libro = leerLibro(contenido);

  const nombreHoja = buscarHoja(libro, hoja);
  if (!nombreHoja) {
    throw new Error(
      `El libro no tiene una hoja llamada "${hoja}". Hojas: ${libro.SheetNames.join(", ")}.`,
    );
  }
  const ws = libro.Sheets[nombreHoja];
  const rango = XLSX.utils.decode_range(ws["!ref"]);
  const celda = (c, r) => ws[XLSX.utils.encode_cell({ c, r })];
  const oculto = (r) => Boolean(ws["!rows"]?.[r]?.hidden);

  // 1. El encabezado del bloque: primera celda VISIBLE que empiece con
  //    "CAPEX 2026". Visible porque la hoja guarda versiones viejas de los
  //    bloques ocultas arriba (renglones 3 a 20 son un "CAPEX 2025" anterior).
  const buscado = normal(bloque);
  let filaEnc = -1;
  let colCodigo = -1;
  for (let r = rango.s.r; r <= rango.e.r && filaEnc < 0; r++) {
    if (oculto(r)) continue;
    for (let c = rango.s.c; c <= Math.min(rango.e.c, rango.s.c + 5); c++) {
      if (normal(celda(c, r)?.v).startsWith(buscado)) {
        filaEnc = r;
        colCodigo = c;
        break;
      }
    }
  }
  if (filaEnc < 0) {
    throw new Error(`No se encontró el bloque "${bloque}" en la hoja "${nombreHoja}".`);
  }

  // 2. Las columnas, por su encabezado
  const encabezados = [];
  for (let c = colCodigo; c <= rango.e.c; c++) {
    encabezados.push({ c, t: normal(celda(c, filaEnc)?.v) });
  }
  const buscar = (re, desde = colCodigo) =>
    encabezados.find((e) => e.c >= desde && re.test(e.t))?.c ?? -1;

  const col = {
    codigo: colCodigo,
    descripcion: colCodigo + 1, // el título del bloque ocupa código + descripción
    // Desde después de la descripción: el título del bloque también dice
    // "da gastar en 2026" y se tomaría por la columna del monto.
    monto: buscar(/gastar|monto inicial/, colCodigo + 2),
    dueno: buscar(/^dueno/),
  };
  col.notas = buscar(/^notas/, col.dueno);
  for (const e of ETAPAS) col[e.clave] = buscar(e.busca);
  col.montoRt = buscar(/^monto relacion tecnica/);
  col.montoFinal = buscar(/^monto final/);
  col.totalGastado = buscar(/^tot\.? ?gastado/);

  // Los cuatro "Gasto(€)" son Q1..Q4, cada uno seguido de su "Notas"
  col.gastos = encabezados.filter((e) => /^gasto/.test(e.t)).map((e) => e.c).slice(0, 4);

  const faltan = [
    ["monto (Da gastar en …)", col.monto],
    ["Dueño del proyecto", col.dueno],
    ["Firmas FOAM", col.firmas_foam],
  ].filter(([, c]) => c < 0);
  if (faltan.length) {
    throw new Error(
      `En el bloque "${bloque}" no se encontró la columna ${faltan.map(([n]) => `"${n}"`).join(", ")}.`,
    );
  }

  // 3. Los renglones, hasta el TOT. del bloque
  const filas = [];
  const avisos = [];
  let ocultos = 0;
  let terminado = false;

  for (let r = filaEnc + 1; r <= rango.e.r && !terminado; r++) {
    const codigo = texto(celda(col.codigo, r));
    const descripcion = texto(celda(col.descripcion, r));

    if (/^tot\.?$/i.test(descripcion || "") || /^tot\.?$/i.test(codigo || "")) {
      terminado = true;
      break;
    }
    // Un encabezado de otro bloque también cierra este
    if (codigo && /^capex \d{4}/i.test(normal(codigo))) break;
    if (!codigo && !descripcion) continue;
    if (oculto(r)) {
      ocultos++;
      continue;
    }

    const etapas = {};
    for (const e of ETAPAS) {
      if (col[e.clave] < 0) continue;
      const c = celda(col[e.clave], r);
      const t = c?.v == null || c.v === "" ? null
        : typeof c.v === "number" && c.v <= 1 ? `${Math.round(c.v * 100)}%`
        : texto(c);
      etapas[e.clave] = { estado: estadoDeRelleno(c), texto: t };
    }

    const montoCelda = celda(col.monto, r);
    const monto = numero(montoCelda);
    const totalGastado = col.totalGastado >= 0 ? numero(celda(col.totalGastado, r)) : null;
    let montoRt = col.montoRt >= 0 ? numero(celda(col.montoRt, r)) : null;

    // El libro mezcla unidades en "Monto relación técnica": 26-MEX-04 dice 595
    // cuando su gasto suma 595,000 €. Un monto de menos de 10 mil en un
    // proyecto que es de cientos de miles está en miles de euros.
    if (montoRt != null && montoRt > 0 && montoRt < 10000 &&
        Math.max(monto || 0, totalGastado || 0) >= 10000) {
      avisos.push(
        `${codigo}: "Monto relación técnica" dice ${montoRt}; se tomó como ` +
          `${(montoRt * 1000).toLocaleString("es-MX")} € (estaba en miles).`,
      );
      montoRt *= 1000;
    }

    const gastos = col.gastos.map((c) => numero(celda(c, r)));
    const notasGasto = col.gastos.map((c) => texto(celda(c + 1, r)));

    filas.push({
      fila: r + 1,
      codigo,
      descripcion,
      dueno: texto(celda(col.dueno, r)),
      notas: col.notas >= 0 ? texto(celda(col.notas, r)) : null,
      monto,
      // 'HSE', 'OPEX': no es un monto pero dice algo
      monto_texto: monto == null ? texto(montoCelda) : null,
      monto_relacion_tecnica: montoRt,
      monto_final: col.montoFinal >= 0 ? numero(celda(col.montoFinal, r)) : null,
      gasto_q1: gastos[0] ?? null,
      gasto_q2: gastos[1] ?? null,
      gasto_q3: gastos[2] ?? null,
      gasto_q4: gastos[3] ?? null,
      notas_gasto: notasGasto.some(Boolean) ? notasGasto : null,
      total_gastado: totalGastado,
      etapas,
      aprobado_foam: etapas.firmas_foam?.estado === "VERDE",
    });
  }

  if (!terminado) {
    avisos.push(`No se encontró el renglón "TOT." del bloque "${bloque}"; se leyó hasta el final de la hoja.`);
  }

  return {
    filas,
    avisos,
    hoja: nombreHoja,
    bloque,
    renglonEncabezado: filaEnc + 1,
    ocultos,
  };
}

/**
 * Lee la hoja 'nuove iniziative': el plan de inversión por iniciativa y su
 * curva de gasto ("Curva di spesa") de 2026 a 2030.
 *
 * ---------------------------------------------------------------------------
 * SUS CÓDIGOS NO SON LOS DE 'Capex update'
 * ---------------------------------------------------------------------------
 * Aquí 26-MEX-01 es "Injection machinery replacement" y en la otra hoja es
 * "Dual Color"; 26-MEX-03 aquí es "HSE" y allá "Mezzanine". Son dos
 * numeraciones distintas con el mismo formato, así que NO se cruzan.
 *
 * ---------------------------------------------------------------------------
 * MILES DE EUROS
 * ---------------------------------------------------------------------------
 * Los años vienen en k€ (el encabezado del total lo dice: "previsto (k€)").
 * Se guardan en euros, como el resto del reporte. La columna oculta "2026,
 * miles" es el mismo 2026 ya en euros y no se lee: se respetan las columnas
 * ocultas igual que los renglones.
 *
 * El total de cada iniciativa se suma de los años y no se lee de la columna
 * del libro (también oculta).
 */
function parsearIniziative(contenido, { hoja }) {
  const libro = leerLibro(contenido);
  const nombreHoja = buscarHoja(libro, hoja);
  if (!nombreHoja) {
    return { filas: [], anios: [], avisos: [`El libro no tiene la hoja "${hoja}".`] };
  }

  const ws = libro.Sheets[nombreHoja];
  const rango = XLSX.utils.decode_range(ws["!ref"]);
  const celda = (c, r) => ws[XLSX.utils.encode_cell({ c, r })];
  const filaOculta = (r) => Boolean(ws["!rows"]?.[r]?.hidden);
  const colOculta = (c) => Boolean(ws["!cols"]?.[c]?.hidden);

  // El encabezado es el renglón que trae "Project code"
  let filaEnc = -1;
  for (let r = rango.s.r; r <= Math.min(rango.e.r, rango.s.r + 15) && filaEnc < 0; r++) {
    for (let c = rango.s.c; c <= rango.e.c; c++) {
      if (/project code/.test(normal(celda(c, r)?.v))) {
        filaEnc = r;
        break;
      }
    }
  }
  if (filaEnc < 0) {
    return { filas: [], anios: [], avisos: [`En "${nombreHoja}" no se encontró el encabezado "Project code".`] };
  }

  const col = {};
  const anios = [];
  for (let c = rango.s.c; c <= rango.e.c; c++) {
    const t = normal(celda(c, filaEnc)?.v);
    if (!t) continue;
    if (/^owner/.test(t)) col.owner = c;
    else if (/project code/.test(t)) col.codigo = c;
    else if (/^descrizione/.test(t)) col.descripcion = c;
    else if (/^stabilimento/.test(t)) col.planta = c;
    else if (/^studi/.test(t)) col.estudios = c;
    else if (/^\d{4}$/.test(t) && !colOculta(c)) anios.push({ anio: Number(t), c });
  }

  const filas = [];
  for (let r = filaEnc + 1; r <= rango.e.r; r++) {
    if (filaOculta(r)) continue;
    const codigo = texto(celda(col.codigo, r));
    const descripcion = texto(celda(col.descripcion, r));
    // Los renglones vacíos del final traen solo la planta y la fórmula del total
    if (!codigo && !descripcion) continue;

    const porAnio = {};
    let total = 0;
    for (const { anio, c } of anios) {
      const v = numero(celda(c, r));
      if (v == null) continue;
      porAnio[anio] = v * 1000;
      total += v * 1000;
    }

    filas.push({
      fila: r + 1,
      codigo,
      descripcion,
      owner: col.owner != null ? texto(celda(col.owner, r)) : null,
      planta: col.planta != null ? texto(celda(col.planta, r)) : null,
      estudios: col.estudios != null ? texto(celda(col.estudios, r)) : null,
      anios: porAnio,
      total,
    });
  }

  return { filas, anios: anios.map((a) => a.anio), avisos: [], hoja: nombreHoja };
}

module.exports = { parsearCapex, parsearIniziative, leerLibro, estadoDeRelleno, ETAPAS };
