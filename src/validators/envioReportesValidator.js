const { body, param, query } = require("express-validator");

const PERIODOS = [
  "SEMANA_ANTERIOR",
  "MES_ANTERIOR",
  "MES_ACTUAL",
  "TRIMESTRE_ANTERIOR",
  "ANIO_ACTUAL",
  "FIJO",
];

const crearListaValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre de la lista es requerido")
    .isLength({ max: 100 })
    .withMessage("El nombre no puede pasar de 100 caracteres"),
  body("descripcion").optional({ nullable: true }).isLength({ max: 500 }),
];

const actualizarListaValidation = [
  param("id").isInt({ min: 1 }),
  body("nombre").optional().trim().notEmpty().isLength({ max: 100 }),
  body("descripcion").optional({ nullable: true }).isLength({ max: 500 }),
  body("activo").optional().isBoolean(),
];

const miembroValidation = [
  param("id").isInt({ min: 1 }),
  body("correo")
    .trim()
    .notEmpty()
    .withMessage("El correo es requerido")
    .isEmail()
    .withMessage("El correo no tiene un formato válido")
    .isLength({ max: 254 })
    .normalizeEmail({ gmail_remove_dots: false }),
  body("nombre").optional({ nullable: true }).trim().isLength({ max: 150 }),
];

/**
 * Alta y edición de una programación.
 *
 * El día es obligatorio salvo en la frecuencia diaria, y su rango depende de si
 * es semanal (0-6) o mensual (1-31). La misma regla existe como CHECK en la
 * base; aquí se valida para poder dar un mensaje entendible.
 */
const programacionValidation = [
  body("nombre")
    .trim()
    .notEmpty()
    .withMessage("El nombre es requerido")
    .isLength({ max: 150 }),
  body("listaId")
    .notEmpty()
    .withMessage("Hay que elegir una lista de correo")
    .isInt({ min: 1 }),
  body("formato").optional().isIn(["PDF", "XLSX", "AMBOS"]),
  body("periodoRelativo")
    .optional()
    .isIn(PERIODOS)
    .withMessage(`periodoRelativo debe ser uno de: ${PERIODOS.join(", ")}`),
  body("frecuencia")
    .optional()
    .isIn(["DIARIA", "SEMANAL", "MENSUAL"])
    .withMessage("La frecuencia debe ser DIARIA, SEMANAL o MENSUAL"),
  body("hora")
    .optional()
    .isInt({ min: 0, max: 23 })
    .withMessage("La hora debe estar entre 0 y 23"),
  body("minuto")
    .optional()
    .isInt({ min: 0, max: 59 })
    .withMessage("El minuto debe estar entre 0 y 59"),
  body("asunto").optional({ nullable: true }).isLength({ max: 200 }),
  body("mensaje").optional({ nullable: true }).isLength({ max: 2000 }),
  body("activo").optional().isBoolean(),

  body("dia").custom((valor, { req }) => {
    const frecuencia = req.body.frecuencia || "SEMANAL";
    if (frecuencia === "DIARIA") return true;
    if (valor === undefined || valor === null || valor === "") {
      throw new Error(
        frecuencia === "SEMANAL"
          ? "Hay que elegir el día de la semana"
          : "Hay que elegir el día del mes",
      );
    }
    const n = Number(valor);
    if (frecuencia === "SEMANAL" && (n < 0 || n > 6)) {
      throw new Error("El día de la semana debe estar entre 0 (domingo) y 6 (sábado)");
    }
    if (frecuencia === "MENSUAL" && (n < 1 || n > 31)) {
      throw new Error("El día del mes debe estar entre 1 y 31");
    }
    return true;
  }),
];

const getEnviosValidation = [
  query("programadoId").optional({ checkFalsy: true }).isInt({ min: 1 }),
  query("limite").optional({ checkFalsy: true }).isInt({ min: 1, max: 200 }),
];

module.exports = {
  crearListaValidation,
  actualizarListaValidation,
  miembroValidation,
  programacionValidation,
  getEnviosValidation,
};
