const fsp = require("fs/promises");
const path = require("path");

/**
 * Para los libros que se guardan como un archivo nuevo en cada revisión.
 *
 * CAPEX ('estratto MEX_piano … Rev 04.xlsx') y AIMS ('KPIs AIMS rev8 Oct
 * 21.xlsx') no sobrescriben el libro: cada revisión es otro archivo, y en la
 * carpeta conviven varias. Se configura el PRINCIPIO del nombre y se elige el
 * de número de Rev más alto; si dos tienen la misma Rev, gana el más reciente.
 * Los temporales de Excel ('~$...') se ignoran: existen mientras alguien tiene
 * el libro abierto.
 */

const normal = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Traduce los errores del sistema de archivos a algo que se entienda. */
function explicarError(e, ruta) {
  switch (e.code) {
    case "ENOENT":
      return `No se encontró "${ruta}".`;
    case "EACCES":
    case "EPERM":
      return `Sin permiso para leer "${ruta}". La cuenta con la que corre el backend necesita acceso de lectura al recurso compartido.`;
    case "EBUSY":
      return "El archivo está en uso. Se reintenta en la siguiente vuelta.";
    case "ETIMEDOUT":
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return `No se pudo llegar al servidor de archivos (${e.code}). Revisar la red.`;
    default:
      return `${e.code || "Error"} al leer "${ruta}": ${e.message}`;
  }
}

/**
 * Elige el libro vigente de la carpeta: el de la Rev más alta.
 *
 * @param {Object} config { carpeta, patron }
 * @returns {Object} { archivo, revision, ruta, mtime }
 */
async function elegirArchivo({ carpeta, patron }) {
  if (!carpeta) {
    const e = new Error("Falta indicar la carpeta donde está el libro.");
    e.sinCarpeta = true;
    throw e;
  }
  const nombres = await fsp.readdir(carpeta);
  const prefijo = normal(patron);

  const candidatos = [];
  for (const n of nombres) {
    if (n.startsWith("~$") || !/\.xls[xm]$/i.test(n)) continue;
    if (!normal(n).startsWith(prefijo)) continue;
    const m = n.match(/rev\.?\s*0*(\d+)/i);
    const ruta = path.win32.join(carpeta, n);
    const st = await fsp.stat(ruta);
    candidatos.push({ archivo: n, revision: m ? Number(m[1]) : null, ruta, mtime: st.mtimeMs });
  }

  if (candidatos.length === 0) {
    const libros = nombres.filter((n) => /\.xls[xm]$/i.test(n) && !n.startsWith("~$"));
    const e = new Error(
      `En la carpeta no hay ningún Excel que empiece con "${patron}". ` +
        (libros.length ? `Hay: ${libros.join(", ")}.` : "No hay ningún Excel."),
    );
    e.sinCandidatos = true;
    throw e;
  }

  candidatos.sort((a, b) => (b.revision ?? -1) - (a.revision ?? -1) || b.mtime - a.mtime);
  return candidatos[0];
}

module.exports = { elegirArchivo, explicarError, normal };
