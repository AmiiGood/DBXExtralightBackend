const PDFDocument = require("pdfkit");

/**
 * Genera el PDF del reporte de Producción Inyección.
 *
 * Se usa pdfkit y no un navegador headless: el envío programado corre a las 8
 * de la mañana sin que nadie tenga el sitio abierto, así que el servidor tiene
 * que dibujar solo. pdfkit es JavaScript puro (sin Chromium ni compilación
 * nativa) y las gráficas que necesitamos son barras, que se dibujan directo.
 *
 * Como en toda la pantalla: se reporta POR UNIDAD DE NEGOCIO y nunca en total,
 * porque unfin, strap, suela y almohada son componentes distintos.
 */

const AZUL = "#236093";
const GRIS = "#6b7280";
const GRIS_CLARO = "#e5e7eb";
const AMBAR = "#b45309";

const COLOR_BU = {
  "Crocs Unfin": "#236093",
  "Crocs Strap": "#2d7ab8",
  Suela: "#95b849",
  Almohada: "#49a090",
  "Dual Color": "#c9761f",
};

const miles = (n) =>
  n == null ? "—" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(2)}%`);

/** Ancho útil de la página. */
const anchoUtil = (doc) =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

/**
 * Devuelve el cursor al margen izquierdo.
 *
 * pdfkit recuerda la x y el ancho del último text() posicionado, así que si no
 * se reinicia, el siguiente texto hereda la columna angosta de la tabla o de la
 * gráfica anterior y se parte en pedazos.
 */
function alMargen(doc) {
  doc.x = doc.page.margins.left;
}

/** Texto a todo lo ancho, sin heredar la columna anterior. */
function parrafo(doc, texto, opciones = {}) {
  alMargen(doc);
  doc.text(texto, doc.page.margins.left, doc.y, {
    width: anchoUtil(doc),
    ...opciones,
  });
  alMargen(doc);
}

/** Barra de título de sección. */
function seccion(doc, texto) {
  // Si no cabe el título más algo de contenido, mejor empezar página
  if (doc.y > 620) doc.addPage();
  alMargen(doc);
  doc.moveDown(0.8);
  doc.fillColor(AZUL).fontSize(12).font("Helvetica-Bold");
  parrafo(doc, texto);
  doc
    .moveTo(doc.page.margins.left, doc.y + 2)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
    .strokeColor(GRIS_CLARO)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.5);
  alMargen(doc);
  doc.fillColor("#111827").font("Helvetica").fontSize(9);
}

/**
 * Tabla simple con anchos fijos.
 * @param {Array} columnas [{ titulo, ancho, alinear }]
 * @param {Array} filas    matriz de strings ya formateados
 * @param {Array} colores  color de texto por fila (opcional), por índice de columna
 */
function tabla(doc, columnas, filas, colores = []) {
  const izquierda = doc.page.margins.left;
  const anchoTotal = doc.page.width - izquierda - doc.page.margins.right;
  const escala = anchoTotal / columnas.reduce((a, c) => a + c.ancho, 0);

  const dibujarEncabezado = () => {
    const y = doc.y;
    doc.rect(izquierda, y, anchoTotal, 16).fill(AZUL);
    let x = izquierda;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    for (const c of columnas) {
      const w = c.ancho * escala;
      doc.text(c.titulo, x + 4, y + 4.5, {
        width: w - 8,
        align: c.alinear || "left",
      });
      x += w;
    }
    doc.y = y + 16;
  };

  dibujarEncabezado();

  filas.forEach((fila, i) => {
    if (doc.y > 740) {
      doc.addPage();
      dibujarEncabezado();
    }
    const y = doc.y;
    if (i % 2 === 1) {
      doc.rect(izquierda, y, anchoTotal, 14).fill("#f9fafb");
    }
    let x = izquierda;
    doc.font("Helvetica").fontSize(8);
    fila.forEach((valor, j) => {
      const w = columnas[j].ancho * escala;
      doc.fillColor(colores[i]?.[j] || "#111827");
      doc.text(String(valor), x + 4, y + 3.5, {
        width: w - 8,
        align: columnas[j].alinear || "left",
        lineBreak: false,
      });
      x += w;
    });
    doc.y = y + 14;
  });
  doc.fillColor("#111827");
  alMargen(doc);
}

/**
 * Gráfica de barras horizontales. Se eligió horizontal y no vertical porque
 * las etiquetas ('Crocs Unfin', 'KS18') caben sin girarlas.
 *
 * @param {Array} datos [{ etiqueta, valor, color }]
 */
function barras(doc, datos, { alto = 12, separacion = 6, sufijo = "" } = {}) {
  if (datos.length === 0) return;
  const izquierda = doc.page.margins.left;
  const anchoTotal = doc.page.width - izquierda - doc.page.margins.right;
  const anchoEtiqueta = 95;
  const anchoValor = 70;
  const anchoBarra = anchoTotal - anchoEtiqueta - anchoValor;
  const maximo = Math.max(...datos.map((d) => Number(d.valor) || 0), 1);

  for (const d of datos) {
    if (doc.y > 745) doc.addPage();
    const y = doc.y;
    const largo = Math.max(1, ((Number(d.valor) || 0) / maximo) * anchoBarra);

    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(8)
      .text(d.etiqueta, izquierda, y + 2, {
        width: anchoEtiqueta - 6,
        lineBreak: false,
      });

    doc.rect(izquierda + anchoEtiqueta, y, anchoBarra, alto).fill("#f3f4f6");
    doc.rect(izquierda + anchoEtiqueta, y, largo, alto).fill(d.color || AZUL);

    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        `${miles(d.valor)}${sufijo}`,
        izquierda + anchoEtiqueta + anchoBarra + 6,
        y + 2,
        { width: anchoValor - 6, align: "right", lineBreak: false },
      );

    doc.y = y + alto + separacion;
  }
  doc.fillColor("#111827");
  alMargen(doc);
}

/**
 * @param {Object} datos       respuesta de InyeccionReporte.getDashboard
 * @param {Object} meta        { titulo, periodo, generadoPor, filtros }
 * @returns {Promise<Buffer>}
 */
function generarPdfInyeccion(datos, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      // Necesario para poder volver sobre las páginas al final y numerarlas
      bufferPages: true,
      margins: { top: 45, bottom: 45, left: 45, right: 45 },
      info: {
        Title: meta.titulo || "Producción Inyección",
        Author: meta.generadoPor || "DBX Extralight",
      },
    });

    const trozos = [];
    doc.on("data", (t) => trozos.push(t));
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);

    // ------------------------------------------------------------ Portada
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(20);
    parrafo(doc, "Producción Inyección");
    doc.fillColor(GRIS).font("Helvetica").fontSize(10);
    parrafo(doc, meta.periodo || "", { paragraphGap: 2 });
    doc.fontSize(8);
    parrafo(
      doc,
      `Generado el ${new Date().toLocaleString("es-MX")}` +
        (meta.generadoPor ? ` por ${meta.generadoPor}` : ""),
    );
    if (meta.filtros) parrafo(doc, `Filtros: ${meta.filtros}`);

    const t = datos?.totales;
    if (t) {
      parrafo(
        doc,
        `${miles(t.registros)} registros` +
          (t.registros_rezago
            ? `, de los cuales ${miles(t.registros_rezago)} son de rezago`
            : ""),
      );
    }

    // -------------------------------------------------- %Scrap por BU
    seccion(doc, "Scrap por unidad de negocio");
    const porBu = (datos?.porBu || []).filter((r) => r.bu);
    tabla(
      doc,
      [
        { titulo: "Unidad de negocio", ancho: 30 },
        { titulo: "Registros", ancho: 15, alinear: "right" },
        { titulo: "Piezas producidas", ancho: 20, alinear: "right" },
        { titulo: "Scrap", ancho: 18, alinear: "right" },
        { titulo: "% Scrap", ancho: 14, alinear: "right" },
      ],
      porBu.map((r) => [
        r.bu,
        miles(r.registros),
        miles(r.produccion),
        miles(r.scrap),
        pct(r.pct_scrap),
      ]),
    );

    doc.moveDown(0.8);
    doc.fillColor(GRIS).fontSize(8);
    parrafo(doc, "% Scrap por unidad de negocio");
    doc.moveDown(0.3);
    barras(
      doc,
      porBu.map((r) => ({
        etiqueta: r.bu,
        valor: r.pct_scrap,
        color: COLOR_BU[r.bu] || AZUL,
      })),
      { sufijo: "%" },
    );

    doc.moveDown(0.5);
    doc.fillColor(GRIS).fontSize(8);
    parrafo(doc, "Piezas producidas");
    doc.moveDown(0.3);
    barras(
      doc,
      porBu.map((r) => ({
        etiqueta: r.bu,
        valor: r.produccion,
        color: COLOR_BU[r.bu] || AZUL,
      })),
    );

    doc.moveDown(0.4);
    doc.fillColor(GRIS).fontSize(7).font("Helvetica-Oblique");
    parrafo(
      doc,
      "Cada unidad de negocio es un componente distinto; no se suman entre sí, " +
        "por eso el reporte no lleva totales.",
    );
    doc.font("Helvetica");

    // ---------------------------------------------------- Por máquina
    const maquinas = (datos?.porMaquina || []).slice(0, 15);
    if (maquinas.length > 0) {
      seccion(doc, "Producción y % Scrap por máquina");
      tabla(
        doc,
        [
          { titulo: "Máquina", ancho: 20 },
          { titulo: "Piezas producidas", ancho: 25, alinear: "right" },
          { titulo: "Scrap", ancho: 20, alinear: "right" },
          { titulo: "% Scrap", ancho: 15, alinear: "right" },
        ],
        maquinas.map((r) => [
          r.maquina,
          miles(r.produccion),
          miles(r.scrap),
          pct(r.pct_scrap),
        ]),
      );
      doc.moveDown(0.3);
      doc.fillColor(GRIS).fontSize(7).font("Helvetica-Oblique");
      parrafo(
        doc,
        "No incluye el rezago, que no tiene máquina asignada." +
          (datos.porMaquina.length > 15
            ? ` Se muestran las 15 máquinas de mayor volumen de ${datos.porMaquina.length}.`
            : ""),
      );
      doc.font("Helvetica");
    }

    // ---------------------------------------------------- Serie del periodo
    const serie = datos?.serie || [];
    if (serie.length > 0) {
      seccion(doc, "Evolución del periodo");
      // Se pivotea a una fila por periodo con una columna de %Scrap por BU
      const bus = [...new Set(serie.map((r) => r.bu).filter(Boolean))];
      const porPeriodo = new Map();
      for (const r of serie) {
        if (!r.bu) continue;
        if (!porPeriodo.has(r.periodo)) {
          porPeriodo.set(r.periodo, { etiqueta: r.etiqueta });
        }
        porPeriodo.get(r.periodo)[r.bu] = r.pct_scrap;
      }
      const periodos = [...porPeriodo.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );

      doc.fillColor(GRIS).fontSize(8);
      parrafo(doc, "% Scrap por periodo");
      doc.moveDown(0.3);
      tabla(
        doc,
        [
          { titulo: "Periodo", ancho: 18 },
          ...bus.map((b) => ({ titulo: b, ancho: 16, alinear: "right" })),
        ],
        periodos
          .slice(-14)
          .map(([, v]) => [v.etiqueta, ...bus.map((b) => pct(v[b]))]),
      );
    }

    // Pie de página en todas las hojas.
    //
    // El pie va por DEBAJO del margen inferior, y pdfkit añade una página nueva
    // en cuanto escribes ahí. Por eso se pone el margen en cero mientras se
    // dibuja y se restaura después: si no, salen hojas en blanco al final.
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);
      const margenAbajo = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .fillColor(GRIS)
        .fontSize(7)
        .font("Helvetica")
        .text(
          `DBX Extralight · Producción Inyección · página ${i + 1} de ${rango.count}`,
          doc.page.margins.left,
          doc.page.height - 30,
          {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
            align: "center",
            lineBreak: false,
          },
        );
      doc.page.margins.bottom = margenAbajo;
    }

    doc.end();
  });
}

module.exports = { generarPdfInyeccion };
