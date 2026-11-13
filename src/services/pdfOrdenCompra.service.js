const PDFDocument = require("pdfkit");

/**
 * El formato de autorización y registro de compras, en PDF, con las firmas
 * estampadas (fase 4 del flujo con firmas).
 *
 * Es el mismo formato que se llenaba en papel: qué se compra, el área, quién
 * pidió, el tipo (Compras), la cuenta y el centro de costos (Finanzas) y las
 * cuatro firmas. Recibe lo que regresa CompraOrden.obtener (con las imágenes de
 * las firmas). Si la orden todavía no está autorizada, o la rechazaron, lo dice
 * arriba en grande para que nadie lo tome por válido.
 *
 * Helvetica (la de pdfkit) no trae el signo menos "−": los negativos van con "-".
 */

const AZUL = "#236093";
const GRIS = "#6b7280";
const TINTA = "#111827";
const LINEA = "#d1d5db";
const ANCHO = 612; // carta
const ALTO = 792;
const M = 40;
const UTIL = ANCHO - 2 * M;

const dinero = (n, moneda = "MXN") =>
  n == null
    ? "-"
    : `${Number(n) < 0 ? "-" : ""}$${Math.abs(Number(n)).toLocaleString("es-MX", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}${moneda === "USD" ? " USD" : ""}`;

const cantidad = (n) => (n == null ? "-" : Number(n).toLocaleString("es-MX", { maximumFractionDigits: 3 }));

/** "2026-11-13T15:39:02" (ya en hora de planta) → "13/11/2026 15:39" */
function fechaHora(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : "-";
}
const fecha = (s) => fechaHora(s).split(" ")[0];

const PASOS = [
  { paso: "GERENTE", nombre: "Gerente del área" },
  { paso: "COMPRAS", nombre: "Compras" },
  { paso: "FINANZAS", nombre: "Finanzas" },
  { paso: "DIRECCION", nombre: "Dirección" },
];

const imagenDe = (dataUrl) => {
  const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
  return m ? Buffer.from(m[1], "base64") : null;
};

/** Salta de hoja si lo que sigue no cabe. */
function cabe(doc, alto) {
  if (doc.y + alto > ALTO - M - 24) {
    doc.addPage();
    doc.y = M;
  }
}

function titulo(doc, texto) {
  cabe(doc, 40);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(AZUL).text(texto.toUpperCase(), M, doc.y, { characterSpacing: 0.5 });
  doc.moveTo(M, doc.y + 2).lineTo(M + UTIL, doc.y + 2).lineWidth(0.7).strokeColor(AZUL).stroke();
  doc.y += 7;
}

/** Renglones etiqueta → valor, en dos columnas. */
function ficha(doc, filas) {
  const anchoEtiqueta = 120;
  for (const [etiqueta, valor] of filas) {
    if (valor == null || valor === "") continue;
    const alto = Math.max(
      doc.font("Helvetica").fontSize(9).heightOfString(String(valor), { width: UTIL - anchoEtiqueta }),
      12,
    );
    cabe(doc, alto + 4);
    const y = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(etiqueta, M, y, { width: anchoEtiqueta - 8 });
    doc.font("Helvetica").fontSize(9).fillColor(TINTA).text(String(valor), M + anchoEtiqueta, y, { width: UTIL - anchoEtiqueta });
    doc.y = y + alto + 4;
  }
}

function partidas(doc, o) {
  const c = o.cotizacion;
  const op = c?.opciones?.find((x) => x.id === o.opcion_id);
  if (!c || !op) return;
  titulo(doc, `Lo que se compra · ${op.proveedor}`);
  const cols = [
    { t: "Descripción", w: 262, a: "left" },
    { t: "Cant.", w: 50, a: "right" },
    { t: "U.M.", w: 45, a: "left" },
    { t: "Precio unitario", w: 85, a: "right" },
    { t: "Importe", w: 90, a: "right" },
  ];
  const fila = (valores, { negrita = false, fondo = null } = {}) => {
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
    const alto = Math.max(...valores.map((v, i) => doc.heightOfString(String(v ?? ""), { width: cols[i].w - 8 }))) + 6;
    cabe(doc, alto);
    const y = doc.y;
    if (fondo) doc.rect(M, y, UTIL, alto).fill(fondo);
    let x = M;
    valores.forEach((v, i) => {
      doc.fillColor(fondo === AZUL ? "#ffffff" : TINTA).text(String(v ?? ""), x + 4, y + 3, { width: cols[i].w - 8, align: cols[i].a });
      x += cols[i].w;
    });
    doc.moveTo(M, y + alto).lineTo(M + UTIL, y + alto).lineWidth(0.4).strokeColor(LINEA).stroke();
    doc.y = y + alto;
  };
  fila(cols.map((x) => x.t), { negrita: true, fondo: AZUL });
  for (const p of c.partidas) {
    const pr = op.precios?.[p.id];
    const desc = pr?.descripcion ? `${p.descripcion}\n${pr.descripcion}` : p.descripcion;
    fila([desc, cantidad(p.cantidad), p.unidad, pr?.precio == null ? "No cotizó" : dinero(pr.precio, op.moneda), dinero(pr?.importe, op.moneda)]);
  }
  fila(["", "", "", c.incluye_iva ? "Total con IVA" : "Total (más IVA)", dinero(op.total, op.moneda)], { negrita: true, fondo: "#f3f4f6" });
  doc.y += 4;
}

function firmas(doc, o) {
  titulo(doc, "Autorizaciones");
  const alto = 128;
  cabe(doc, alto + 10);
  const sep = 8;
  const w = (UTIL - sep * 3) / 4;
  const y = doc.y;
  PASOS.forEach(({ paso, nombre }, i) => {
    const x = M + i * (w + sep);
    const f = o.firmas?.find((z) => z.paso === paso);
    doc.roundedRect(x, y, w, alto, 4).lineWidth(0.6).strokeColor(LINEA).stroke();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GRIS).text(nombre.toUpperCase(), x + 6, y + 6, { width: w - 12 });
    const lineaY = y + 76;
    if (f) {
      const img = imagenDe(f.imagen);
      if (img) {
        try {
          doc.image(img, x + 6, y + 18, { fit: [w - 12, 56], align: "center", valign: "bottom" });
        } catch {
          // Una imagen dañada no debe impedir el PDF: queda el nombre y la hora
        }
      }
      doc.moveTo(x + 8, lineaY).lineTo(x + w - 8, lineaY).lineWidth(0.6).strokeColor("#9ca3af").stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor(TINTA).text(f.nombre, x + 4, lineaY + 4, { width: w - 8, align: "center" });
      doc.font("Helvetica").fontSize(7).fillColor(GRIS).text(f.comoTexto, x + 4, doc.y + 1, { width: w - 8, align: "center" });
      doc.text(fechaHora(f.firmado_en), x + 4, doc.y + 1, { width: w - 8, align: "center" });
    } else {
      let texto = o.estado === "EN_FIRMAS" ? (o.paso === paso ? "Esperando su firma" : "Pendiente") : "Sin firma";
      if (paso === "DIRECCION" && o.requiere_direccion === false) {
        texto = `No requerida: ${dinero(o.monto_mxn_sin_iva)} sin IVA, abajo del mínimo de ${dinero(o.monto_minimo_direccion)}`;
      }
      if (o.estado === "RECHAZADA" && o.rechazada_paso === paso) texto = `Rechazó ${o.rechazada_por_nombre}`;
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(o.estado === "RECHAZADA" && o.rechazada_paso === paso ? "#b91c1c" : GRIS)
        .text(texto, x + 6, y + 50, { width: w - 12, align: "center" });
    }
  });
  doc.y = y + alto + 6;
}

/**
 * @param {Object} o  CompraOrden.obtener
 * @returns {Promise<Buffer>}
 */
function generar(o) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      bufferPages: true,
      margins: { top: M, bottom: M, left: M, right: M },
      info: {
        Title: `Orden de compra ${o.folio} · ${o.osticket_numero || ""}`,
        Author: "DBX Extralight",
        Subject: "Formato de autorización y registro de compras",
      },
    });
    const partes = [];
    doc.on("data", (b) => partes.push(b));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);

    // --- Encabezado ---
    doc.font("Helvetica-Bold").fontSize(14).fillColor(AZUL).text("Formato de autorización y registro de compras", M, M, { width: UTIL - 170 });
    doc.font("Helvetica").fontSize(9).fillColor(GRIS).text("Orden de compra firmada en DBX Extralight", M, doc.y + 2, { width: UTIL - 170 });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(TINTA).text(o.osticket_numero || "", M + UTIL - 160, M, { width: 160, align: "right" });
    doc.font("Helvetica").fontSize(8.5).fillColor(GRIS).text(`Folio ${o.folio}`, M + UTIL - 160, M + 14, { width: 160, align: "right" });
    doc.text(
      o.estado === "AUTORIZADA" ? `Autorizada ${fechaHora(o.terminada_en)}` : `Enviada ${fechaHora(o.enviada_en)}`,
      M + UTIL - 160,
      M + 26,
      { width: 160, align: "right" },
    );
    doc.y = Math.max(doc.y, M + 44);

    // --- ¿Vale? ---
    if (o.estado !== "AUTORIZADA") {
      const rechazada = o.estado === "RECHAZADA";
      const texto = rechazada
        ? `NO AUTORIZADA · La rechazó ${o.rechazada_por_nombre}: “${o.motivo_rechazo}”`
        : "EN FIRMAS · Todavía no está autorizada: este documento no vale como orden de compra";
      doc.font("Helvetica-Bold").fontSize(9);
      const h = doc.heightOfString(texto, { width: UTIL - 20 }) + 12;
      doc.roundedRect(M, doc.y, UTIL, h, 4).fill(rechazada ? "#fee2e2" : "#fef3c7");
      doc.fillColor(rechazada ? "#991b1b" : "#92400e").text(texto, M + 10, doc.y + 6, { width: UTIL - 20 });
      doc.y += 8;
    }

    // --- Datos ---
    const op = o.cotizacion?.opciones?.find((x) => x.id === o.opcion_id);
    titulo(doc, "Solicitud");
    ficha(doc, [
      ["Fecha", o.estado === "AUTORIZADA" ? fecha(o.terminada_en) : fecha(o.enviada_en)],
      ["Área solicitante", o.area_nombre],
      ["Solicitó", o.solicitante_nombre],
      ["Requerimiento", o.asunto],
      ["Detalle", o.detalle && o.detalle.length > 900 ? `${o.detalle.slice(0, 900).trimEnd()}…` : o.detalle],
      ["Comentario", o.comentario],
      ["Proveedor", o.proveedor],
      ["Monto", `${dinero(o.monto, o.moneda)} ${o.incluye_iva ? "con IVA" : "más IVA"}`],
      ["Tiempo de entrega", op?.tiempo_entrega],
      ["Crédito", op?.credito],
      ["Lo atiende en Compras", o.asignado_nombre],
    ]);

    partidas(doc, o);

    titulo(doc, "Clasificación");
    ficha(doc, [
      ["Tipo de compra", o.clasif_tipo || "Lo pone Compras al firmar"],
      ["Cuenta", o.cuenta ? `${o.cuenta}${o.cuenta_nombre ? ` · ${o.cuenta_nombre}` : ""}` : "La pone Finanzas al firmar"],
      ["Centro de costos", o.centro_costos || (o.cuenta ? "-" : "Lo pone Finanzas al firmar")],
      [
        "Presupuesto",
        o.estado === "AUTORIZADA" && o.monto_presupuesto != null
          ? `Se descontaron ${dinero(o.monto_presupuesto)} del presupuesto de ${o.area_nombre} (sin IVA, en pesos)`
          : null,
      ],
    ]);

    firmas(doc, o);

    // --- Pie, en todas las hojas ---
    const hojas = doc.bufferedPageRange();
    for (let i = hojas.start; i < hojas.start + hojas.count; i++) {
      doc.switchToPage(i);
      // El pie va dentro del margen de abajo: sin esto pdfkit abriría otra hoja
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7).fillColor("#9ca3af").text(
        `Cada firma se confirmó con el PIN personal de quien firma. Generado por DBX Extralight el ${fechaHora(o.generado_en)} · Hoja ${i - hojas.start + 1} de ${hojas.count}`,
        M,
        ALTO - M - 10,
        { width: UTIL, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}

module.exports = { generar };
