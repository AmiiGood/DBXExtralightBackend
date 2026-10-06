const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

/**
 * Archivos adjuntos de las solicitudes de Compra.
 *
 * Van a disco, en COMPRAS_ARCHIVOS_DIR (por omisión `storage/compras` junto al
 * backend), en una carpeta por mes. El nombre en disco es aleatorio; el que
 * puso el usuario solo se guarda en la BD para mostrarlo y para descargar.
 *
 * Tipos: imágenes, PDF y Excel. Es lo que de verdad se adjunta hoy en el
 * osTicket de Compras (2026: 509 imágenes, 107 Excel, 47 PDF).
 */

const RAIZ = path.resolve(
  process.env.COMPRAS_ARCHIVOS_DIR || path.join(__dirname, "..", "..", "storage", "compras"),
);

const MAX_MB = 10;
const MAX_ARCHIVOS = 10;
// Todo junto viaja a osTicket en una sola petición y en base64 (un tercio más
// pesado). PHP en XAMPP suele cortar el POST en 40 MB: 25 MB deja margen.
const MAX_TOTAL_MB = 25;

const PERMITIDOS = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
  ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv",
};

/**
 * El navegador manda el nombre en UTF-8 pero busboy lo lee como latin1:
 * "cotización.pdf" llega como "cotizaciÃ³n.pdf". Se repara solo si el
 * resultado es UTF-8 válido, para no romper un nombre que ya venía bien.
 */
function repararNombre(nombre) {
  const reparado = Buffer.from(nombre, "latin1").toString("utf8");
  return reparado.includes("�") ? nombre : reparado;
}

const subida = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const mes = new Date().toISOString().slice(0, 7);
      const dir = path.join(RAIZ, mes);
      fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: MAX_ARCHIVOS },
  fileFilter: (req, file, cb) => {
    file.originalname = repararNombre(file.originalname);
    const ext = path.extname(file.originalname).toLowerCase();
    if (PERMITIDOS[ext]) return cb(null, true);
    cb(new Error(`"${file.originalname}" no se acepta. Solo imágenes, PDF y Excel.`));
  },
});

/** Middleware: recibe `archivos[]` y traduce los errores de multer. */
const recibirArchivos = (req, res, next) =>
  subida.array("archivos", MAX_ARCHIVOS)(req, res, (err) => {
    if (!err) return next();
    borrar(req.files);
    const mensajes = {
      LIMIT_FILE_SIZE: `Cada archivo puede pesar hasta ${MAX_MB} MB`,
      LIMIT_FILE_COUNT: `Máximo ${MAX_ARCHIVOS} archivos por solicitud`,
      LIMIT_UNEXPECTED_FILE: `Máximo ${MAX_ARCHIVOS} archivos por solicitud`,
    };
    return res.status(400).json({
      status: "error",
      message: mensajes[err.code] || err.message || "No se pudieron recibir los archivos",
    });
  });

/** De lo que dejó multer a lo que se guarda en la BD. */
function describir(files = []) {
  return files.map((f) => ({
    nombreOriginal: f.originalname.slice(0, 255),
    ruta: path.relative(RAIZ, f.path).split(path.sep).join("/"),
    // El tipo sale de la extensión ya validada, no del que declaró el navegador
    tipoMime: PERMITIDOS[path.extname(f.originalname).toLowerCase()],
    tamanoBytes: f.size,
  }));
}

/** Mensaje de error si lo recibido pasa del tope total; null si cabe. */
function excedeTotal(files = []) {
  const total = (files || []).reduce((suma, f) => suma + f.size, 0);
  return total > MAX_TOTAL_MB * 1024 * 1024
    ? `Entre todos los archivos pueden pesar hasta ${MAX_TOTAL_MB} MB`
    : null;
}

/** Borra lo recibido cuando la solicitud no se llegó a guardar. */
function borrar(files = []) {
  for (const f of files || []) {
    fs.unlink(f.path, () => {});
  }
}

/** Ruta absoluta de un archivo guardado, sin dejar salir de la carpeta. */
function rutaAbsoluta(rutaRelativa) {
  const absoluta = path.resolve(RAIZ, rutaRelativa);
  if (!absoluta.startsWith(RAIZ + path.sep)) {
    throw new Error("Ruta de archivo inválida");
  }
  return absoluta;
}

module.exports = {
  recibirArchivos,
  describir,
  borrar,
  rutaAbsoluta,
  excedeTotal,
  MAX_MB,
  MAX_TOTAL_MB,
  MAX_ARCHIVOS,
  EXTENSIONES: Object.keys(PERMITIDOS),
};
