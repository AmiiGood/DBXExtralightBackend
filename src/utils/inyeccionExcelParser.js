const XLSX = require("xlsx");

/**
 * Parser del archivo "Producción Inyección.xlsx" (hoja Producción).
 *
 * No toca la base de datos: recibe el archivo, devuelve filas normalizadas,
 * el catálogo de productos que aparece en ellas y las advertencias. Lo usan
 * tanto el script de carga histórica como el endpoint de importación.
 *
 * Normalizaciones que aplica (medidas sobre las 336,567 filas del histórico):
 *   - Estación: '07-A', 'S7-A' y '7A' son lo mismo → '07-A'.
 *   - Color: el Excel mezcla texto y número ('001' y 1, '410' y 410) → texto
 *     de 3 dígitos con ceros a la izquierda.
 *   - BU: 'Suela ' con espacio final → 'Suela'. El '0' del VLOOKUP fallido → null.
 *   - Turno: 'A (2)' → letra A. El número entre paréntesis coincide con el id
 *     de la tabla turnos, pero mandamos la letra por ser más estable.
 *   - Fecha: acepta fecha real o texto 'dd/mm/aa' y 'dd/mm/aaaa'.
 */

const HOJA = "Producción";

const COLUMNAS = [
  "Fecha", "Máquina", "Estaciones", "Turno", "Cavidades", "Modelo", "Color",
  "Talla", "Inicial", "Final", "Producción", "Scrap", "Concatenado", "SKU",
  "Descripción", "Ciclos", "BU",
];

const BUS_VALIDAS = [
  "Crocs Unfin", "Crocs Strap", "Suela", "Almohada", "Dual Color",
];

/**
 * '07-A' | 'S7-A' | '7A'  ->  '07-A'.  Devuelve null si no se reconoce.
 */
function normalizarEstacion(valor) {
  if (valor === null || valor === undefined) return null;
  const m = String(valor).trim().toUpperCase().match(/^S?(\d{1,2})\s*-?\s*([AB])$/);
  return m ? `${String(m[1]).padStart(2, "0")}-${m[2]}` : null;
}

/**
 * 'A (2)' | 'A' -> 'A'.  Devuelve null si no se reconoce.
 */
function normalizarTurno(valor) {
  if (!valor) return null;
  const m = String(valor).trim().toUpperCase().match(/^([ABC])/);
  return m ? m[1] : null;
}

/**
 * El Excel guarda el mismo color como '001' y como 1. Se unifica a texto de
 * 3 dígitos; los códigos con letras ('0DA', '6ZW') se dejan tal cual.
 */
function normalizarColor(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") {
    if (valor === 0) return null;
    return String(valor).padStart(3, "0");
  }
  const s = String(valor).trim().toUpperCase();
  if (!s || s === "0") return null;
  return /^\d+$/.test(s) ? s.padStart(3, "0") : s;
}

/**
 * La talla la corrompe el autocorrector de Excel: el capturista teclea "5/6" y
 * la celda queda como fecha 05/06. Se reconstruye como día/mes, que es lo que
 * confirma el sufijo del SKU ('B6-OUT-CAM-02-608FMXNER-US-5/6'). Son 80 filas.
 */
function normalizarTalla(valor) {
  if (valor instanceof Date && !isNaN(valor)) {
    return `${valor.getDate()}/${valor.getMonth() + 1}`;
  }
  return normalizarTexto(valor);
}

function normalizarTexto(valor) {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  return s === "" || s === "0" ? null : s;
}

function normalizarFecha(valor) {
  if (valor instanceof Date && !isNaN(valor)) {
    // El Excel guarda fechas sin hora; se arma en local para no correr un día.
    const y = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, "0");
    const d = String(valor.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof valor === "string") {
    const m = valor.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (m) {
      let [, d, mes, y] = m;
      y = y.length === 2 ? `20${y}` : y;
      return `${y}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

function aNumero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Del SKU se extrae la variante de color: el Excel pone Color '001' pero el
 * SKU dice '001B2' (descripción "Blk2"). Sin esto no se puede regenerar el SKU.
 * PENDIENTE: confirmar con planta qué significa el sufijo.
 */
function extraerVariante(sku, colorNormalizado) {
  if (!sku || !colorNormalizado) return null;
  const partes = String(sku).split("-");
  if (partes.length < 2) return null;
  const segmento = partes[partes.length - 2];
  if (!segmento || segmento === colorNormalizado) return null;
  return segmento.startsWith(colorNormalizado)
    ? segmento.slice(colorNormalizado.length)
    : null;
}

/**
 * @param {String|Buffer} archivo - ruta del .xlsx o buffer del archivo subido
 * @returns {{ filas, productos, resumen, advertencias }}
 *   filas       filas listas para insertar (aún sin ids de catálogo)
 *   productos   Map sku -> datos del producto semiterminado
 *   resumen     conteos para la bitácora
 *   advertencias problemas que NO detienen la carga
 */
function parseProduccionInyeccion(archivo) {
  const libro = typeof archivo === "string"
    ? XLSX.readFile(archivo, { cellDates: true, dense: true })
    : XLSX.read(archivo, { type: "buffer", cellDates: true, dense: true });

  if (!libro.SheetNames.includes(HOJA)) {
    throw new Error(`El archivo debe contener una hoja llamada "${HOJA}"`);
  }

  const matriz = XLSX.utils.sheet_to_json(libro.Sheets[HOJA], {
    header: 1,
    raw: true,
    blankrows: false,
  });

  if (matriz.length === 0) throw new Error(`La hoja "${HOJA}" está vacía`);

  const encabezado = matriz[0].map((h) => String(h || "").trim());
  const faltantes = COLUMNAS.filter((c) => !encabezado.includes(c));
  if (faltantes.length > 0) {
    throw new Error(`Faltan columnas en la hoja "${HOJA}": ${faltantes.join(", ")}`);
  }
  const col = {};
  COLUMNAS.forEach((c) => { col[c] = encabezado.indexOf(c); });

  const filas = [];
  const productos = new Map();
  const advertencias = [];
  const resumen = {
    totalHoja: matriz.length - 1,
    validas: 0,
    scrapPorModelo: 0,
    scrapNegativo: 0,
    sinMaquina: 0,
    sinFecha: 0,
    sinTurno: 0,
    estacionNoReconocida: 0,
    produccionRecalculada: 0,
    tallaCorregida: 0,
    sinSku: 0,
  };
  // Para no llenar la bitácora con miles de líneas repetidas
  const avisar = (tipo, mensaje, fila) => {
    if (advertencias.filter((a) => a.tipo === tipo).length < 20) {
      advertencias.push({ tipo, mensaje, fila });
    }
  };

  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i];
    if (!r || r.every((v) => v === null || v === undefined || v === "")) continue;
    const numFila = i + 1; // como se ve en Excel

    const fecha = normalizarFecha(r[col["Fecha"]]);
    const maquina = normalizarTexto(r[col["Máquina"]]);
    const turno = normalizarTurno(r[col["Turno"]]);
    const scrapCrudo = aNumero(r[col["Scrap"]]) ?? 0;

    if (!fecha) {
      resumen.sinFecha++;
      avisar("sin_fecha", `Fila ${numFila}: fecha ilegible, se omite`, numFila);
      continue;
    }

    // Sin máquina hay dos casos muy distintos:
    //   - con scrap  -> es el rezago: scrap a nivel modelo, SÍ cuenta (13% del
    //                   scrap total del histórico). Puede venir NEGATIVO: son
    //                   1,405 renglones de ajuste que restan -5,982.5 en total.
    //   - en ceros   -> renglón vacío de relleno, se omite
    const tipo = maquina ? "PRODUCCION" : "SCRAP_MODELO";
    if (tipo === "SCRAP_MODELO" && scrapCrudo === 0) {
      resumen.sinMaquina++;
      continue;
    }
    if (scrapCrudo < 0) resumen.scrapNegativo++;
    if (tipo === "PRODUCCION" && !turno) {
      resumen.sinTurno++;
      avisar("sin_turno", `Fila ${numFila}: turno ilegible, se omite`, numFila);
      continue;
    }

    const estacionCruda = r[col["Estaciones"]];
    const estacion = normalizarEstacion(estacionCruda);
    if (!estacion && normalizarTexto(estacionCruda)) {
      resumen.estacionNoReconocida++;
      avisar("estacion", `Fila ${numFila}: estación "${estacionCruda}" no reconocida, queda sin estación`, numFila);
    }

    const cavidades = tipo === "PRODUCCION" ? aNumero(r[col["Cavidades"]]) ?? 0 : 0;
    const inicial = tipo === "PRODUCCION" ? aNumero(r[col["Inicial"]]) : null;
    const final = tipo === "PRODUCCION" ? aNumero(r[col["Final"]]) : null;
    let produccion = tipo === "PRODUCCION" ? aNumero(r[col["Producción"]]) ?? 0 : 0;
    const scrap = scrapCrudo;

    // Si no vino producción pero sí contadores, se calcula.
    if (produccion === 0 && inicial !== null && final !== null && final > inicial) {
      produccion = (final - inicial) * cavidades;
      resumen.produccionRecalculada++;
    }

    const sku = normalizarTexto(r[col["SKU"]]);
    const modelo = normalizarTexto(r[col["Modelo"]]);
    const color = normalizarColor(r[col["Color"]]);
    const tallaCruda = r[col["Talla"]];
    const talla = normalizarTalla(tallaCruda);
    if (tallaCruda instanceof Date) resumen.tallaCorregida++;
    const descripcion = normalizarTexto(r[col["Descripción"]]);
    let bu = normalizarTexto(r[col["BU"]]);
    if (bu) {
      bu = bu.trim();
      if (!BUS_VALIDAS.includes(bu)) {
        avisar("bu", `Fila ${numFila}: BU "${bu}" no está en el catálogo del reporte`, numFila);
        bu = null;
      }
    }

    if (!sku) resumen.sinSku++;
    else if (!productos.has(sku)) {
      productos.set(sku, {
        sku,
        descripcion,
        modelo,
        color,
        variante: extraerVariante(sku, color),
        talla,
        bu,
      });
    }

    filas.push({
      fila: numFila,
      tipo,
      fecha,
      turno: tipo === "PRODUCCION" ? turno : null,
      maquina: maquina ? maquina.toUpperCase() : null,
      estacion,
      estacionOrigen: estacionCruda === null || estacionCruda === undefined
        ? null : String(estacionCruda).trim().slice(0, 20),
      sku,
      cavidades,
      contadorInicial: inicial,
      contadorFinal: final,
      produccion,
      scrap,
      bu,
      modelo,
    });
    if (tipo === "SCRAP_MODELO") resumen.scrapPorModelo++;
    resumen.validas++;
  }

  return { filas, productos, resumen, advertencias };
}

module.exports = {
  parseProduccionInyeccion,
  normalizarEstacion,
  normalizarTurno,
  normalizarColor,
  normalizarFecha,
};
