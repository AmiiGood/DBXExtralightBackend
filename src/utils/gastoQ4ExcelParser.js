const XLSX = require("xlsx");

/**
 * Lector del libro "Budget Acumulado" (gasto indispensable de octubre a
 * diciembre por área).
 *
 * La hoja que cuenta es la del trimestre (Q42026): un renglón por concepto con
 *
 *   Departamento | Concepto | octubre | noviembre | diciembre
 *
 * y al final un renglón de sumas sin departamento. El libro trae otras hojas
 * con el mismo encabezado (Sheet1, que es el borrador de RH con su presupuesto
 * original), así que se prefiere la hoja cuyo nombre dice Q4.
 *
 * Las columnas se encuentran por su encabezado, no por su letra.
 *
 * Limpieza:
 *   - Montos a número con dos decimales. Una celda vacía es cero; un guion u
 *     otro texto también, pero se avisa (HSE trae "-" en noviembre y diciembre).
 *   - Concepto sin saltos de línea ni espacios dobles.
 */

const MESES = ["octubre", "noviembre", "diciembre"];

const normal = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const texto = (v) => {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};

/** Monto de una celda: { valor, texto } — `texto` trae lo que había si no era número. */
function monto(v) {
  if (v == null || v === "") return { valor: 0 };
  if (typeof v === "number") return { valor: Math.round(v * 100) / 100 };
  const t = String(v).trim();
  if (t === "") return { valor: 0 };
  const limpio = t.replace(/[$,\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(limpio)) return { valor: Math.round(Number(limpio) * 100) / 100 };
  return { valor: 0, texto: t };
}

/** Índice de la fila de títulos y de cada columna, o null si la hoja no los tiene. */
function buscarTitulos(renglones) {
  for (let i = 0; i < Math.min(renglones.length, 15); i++) {
    const t = (renglones[i] || []).map(normal);
    const col = (re) => t.findIndex((c) => re.test(c));
    const c = {
      departamento: col(/^(departamento|area)$/),
      concepto: col(/^concepto$/),
      octubre: col(/^oct(ubre)?$/),
      noviembre: col(/^nov(iembre)?$/),
      diciembre: col(/^dic(iembre)?$/),
    };
    if (Object.values(c).every((x) => x >= 0)) return { fila: i, c };
  }
  return null;
}

/**
 * Lee el libro.
 *
 * @param {Buffer|String} contenido
 * @param {Object} opciones { nombreArchivo } — para sacar el año si la hoja no lo dice
 * @returns {Object} { hoja, anio, filas, totalArchivo, avisos }
 *   filas: [{ renglon, departamento, concepto, octubre, noviembre, diciembre }]
 *   totalArchivo: { octubre, noviembre, diciembre } del renglón de sumas, o null
 */
function parsearGastoQ4(contenido, opciones = {}) {
  const libro = Buffer.isBuffer(contenido)
    ? XLSX.read(contenido, { type: "buffer" })
    : XLSX.readFile(contenido);

  // La hoja del trimestre primero; si no hay, la primera con el encabezado
  const candidatas = [
    ...libro.SheetNames.filter((n) => /q\s*4/i.test(n)),
    ...libro.SheetNames.filter((n) => !/q\s*4/i.test(n)),
  ];
  let hoja = null;
  let renglones = null;
  let titulos = null;
  for (const n of candidatas) {
    const r = XLSX.utils.sheet_to_json(libro.Sheets[n], { header: 1, raw: true, defval: null });
    const t = buscarTitulos(r);
    if (t) {
      hoja = n;
      renglones = r;
      titulos = t;
      break;
    }
  }
  if (!hoja) {
    throw new Error(
      "No se encontró una hoja con las columnas Departamento, Concepto, octubre, noviembre y diciembre.",
    );
  }

  const { c } = titulos;
  const filas = [];
  const conTexto = [];
  let sinConcepto = 0;
  let totalArchivo = null;

  for (let i = titulos.fila + 1; i < renglones.length; i++) {
    const r = renglones[i] || [];
    const departamento = texto(r[c.departamento]);
    const concepto = texto(r[c.concepto]);
    const montos = MESES.map((m) => monto(r[c[m]]));

    if (!departamento) {
      // El renglón de sumas: sin departamento ni concepto y con números
      if (!concepto && !totalArchivo && MESES.every((m) => typeof r[c[m]] === "number")) {
        totalArchivo = Object.fromEntries(MESES.map((m, k) => [m, montos[k].valor]));
      }
      continue;
    }
    if (!concepto) {
      sinConcepto++;
      continue;
    }
    montos.forEach((x, k) => {
      if (x.texto != null) conTexto.push(`renglón ${i + 1} (${concepto}, ${MESES[k]}): "${x.texto}"`);
    });
    filas.push({
      renglon: i + 1,
      departamento,
      concepto,
      ...Object.fromEntries(MESES.map((m, k) => [m, montos[k].valor])),
    });
  }

  const avisos = [];
  if (conTexto.length) {
    avisos.push(`Montos con texto en lugar de número, se tomaron como cero: ${conTexto.join("; ")}.`);
  }
  if (sinConcepto) avisos.push(`${sinConcepto} renglones con departamento pero sin concepto no se cargaron.`);

  const anio =
    Number((hoja.match(/(20\d{2})/) || [])[1]) ||
    Number(((opciones.nombreArchivo || "").match(/(20\d{2})/) || [])[1]) ||
    new Date().getFullYear();

  return { hoja, anio, filas, totalArchivo, avisos };
}

module.exports = { parsearGastoQ4, MESES };
