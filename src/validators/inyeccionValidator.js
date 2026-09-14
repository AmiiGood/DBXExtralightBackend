const { query, body } = require("express-validator");

/**
 * Validación de los filtros de los reportes de inyección.
 * Todos son opcionales: sin filtros se devuelve el histórico completo.
 */
const getDashboardValidation = [
  query("fechaInicio")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("fechaInicio debe ser una fecha AAAA-MM-DD"),

  query("fechaFin")
    .optional({ checkFalsy: true })
    .isISO8601()
    .withMessage("fechaFin debe ser una fecha AAAA-MM-DD"),

  query("anio")
    .optional({ checkFalsy: true })
    .isInt({ min: 2000, max: 2100 })
    .withMessage("anio debe ser un año válido"),

  query("mes")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 12 })
    .withMessage("mes debe estar entre 1 y 12"),

  query("semana")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 53 })
    .withMessage("semana debe estar entre 1 y 53"),

  query("trimestre")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 4 })
    .withMessage("trimestre debe estar entre 1 y 4"),

  query("semestre")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 2 })
    .withMessage("semestre debe ser 1 o 2"),

  query("agrupar")
    .optional({ checkFalsy: true })
    .isIn(["anio", "semestre", "trimestre", "mes", "semana", "fecha"])
    .withMessage(
      "agrupar debe ser anio, semestre, trimestre, mes, semana o fecha",
    ),

  // bu llega como lista separada por comas: ?bu=Crocs Unfin,Suela
  query("bu")
    .optional({ checkFalsy: true })
    .custom((valor) => {
      const validas = [
        "Crocs Unfin",
        "Crocs Strap",
        "Suela",
        "Almohada",
        "Dual Color",
      ];
      const partes = String(valor)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const malas = partes.filter((p) => !validas.includes(p));
      if (malas.length > 0) {
        throw new Error(`Unidad de negocio no válida: ${malas.join(", ")}`);
      }
      return true;
    }),
];

/**
 * Comparación de dos periodos.
 *
 * El número máximo depende del tipo: 12 meses, 4 trimestres, 2 semestres.
 */
const LIMITE_POR_TIPO = { mes: 12, trimestre: 4, semestre: 2, anio: 1 };

const compararValidation = [
  query("tipo")
    .optional({ checkFalsy: true })
    .isIn(["mes", "trimestre", "semestre", "anio"])
    .withMessage("tipo debe ser mes, trimestre, semestre o anio"),

  query("aAnio")
    .notEmpty()
    .withMessage("Falta el año del periodo A")
    .isInt({ min: 2000, max: 2100 }),
  query("bAnio")
    .notEmpty()
    .withMessage("Falta el año del periodo B")
    .isInt({ min: 2000, max: 2100 }),

  query("aNum").optional({ checkFalsy: true }).isInt({ min: 1, max: 12 }),
  query("bNum").optional({ checkFalsy: true }).isInt({ min: 1, max: 12 }),

  query().custom((_, { req }) => {
    const tipo = req.query.tipo || "mes";
    const tope = LIMITE_POR_TIPO[tipo];
    for (const clave of ["aNum", "bNum"]) {
      const v = req.query[clave];
      if (v && Number(v) > tope) {
        throw new Error(
          `Con tipo "${tipo}" el número no puede pasar de ${tope} (recibido ${v} en ${clave})`,
        );
      }
    }
    // Comparar un periodo contra sí mismo no aporta nada
    if (
      req.query.aAnio === req.query.bAnio &&
      String(req.query.aNum || 1) === String(req.query.bNum || 1)
    ) {
      throw new Error("Los dos periodos a comparar son el mismo");
    }
    return true;
  }),
];

/** Consulta de un turno ya capturado. */
const getCapturaValidation = [
  query("fecha")
    .notEmpty()
    .withMessage("La fecha es requerida")
    .isISO8601()
    .withMessage("fecha debe ser AAAA-MM-DD"),
  query("maquinaId")
    .notEmpty()
    .withMessage("La máquina es requerida")
    .isInt({ min: 1 })
    .withMessage("maquinaId debe ser un entero positivo"),
  query("turnoId")
    .notEmpty()
    .withMessage("El turno es requerido")
    .isInt({ min: 1 })
    .withMessage("turnoId debe ser un entero positivo"),
];

const getAvanceValidation = [
  query("fecha")
    .notEmpty()
    .withMessage("La fecha es requerida")
    .isISO8601()
    .withMessage("fecha debe ser AAAA-MM-DD"),
];

/**
 * Guardado del turno.
 *
 * La fecha se captura a mano (en planta no hay forma de saber cuándo se
 * registra), pero no se admite una fecha futura: sería siempre un dedazo.
 */
const guardarCapturaValidation = [
  body("fecha")
    .notEmpty()
    .withMessage("La fecha es requerida")
    .isISO8601()
    .withMessage("fecha debe ser AAAA-MM-DD")
    .custom((v) => {
      const hoy = new Date();
      hoy.setHours(23, 59, 59, 999);
      if (new Date(`${v}T00:00:00`) > hoy) {
        throw new Error("La fecha no puede ser futura");
      }
      return true;
    }),

  body("maquinaId").isInt({ min: 1 }).withMessage("Máquina no válida"),
  body("turnoId").isInt({ min: 1 }).withMessage("Turno no válido"),

  body("renglones")
    .isArray({ min: 1 })
    .withMessage("Hay que mandar al menos un renglón"),

  body("renglones.*.estacionId")
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage("Estación no válida"),
  body("renglones.*.productoId")
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage("Producto no válido"),
  body("renglones.*.cavidades")
    .optional({ nullable: true })
    .isFloat({ min: 0, max: 999 })
    .withMessage("Cavidades debe estar entre 0 y 999"),
  body("renglones.*.contadorInicial")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("El contador inicial no puede ser negativo"),
  body("renglones.*.contadorFinal")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("El contador final no puede ser negativo"),
  body("renglones.*.produccion")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("La producción no puede ser negativa"),
  // El scrap de captura sí es siempre positivo; los ajustes negativos solo
  // existen en el rezago, que no se captura por este formulario.
  body("renglones.*.scrap")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("El scrap no puede ser negativo"),
  body("renglones.*.observaciones")
    .optional({ nullable: true })
    .isLength({ max: 500 })
    .withMessage("Las observaciones no pueden pasar de 500 caracteres"),

  // El contador no puede ir para atrás
  body("renglones").custom((renglones) => {
    for (const [i, r] of (renglones || []).entries()) {
      const ini = r.contadorInicial;
      const fin = r.contadorFinal;
      if (ini != null && fin != null && Number(fin) < Number(ini)) {
        throw new Error(
          `Renglón ${i + 1}: el contador final (${fin}) es menor que el inicial (${ini})`,
        );
      }
    }
    return true;
  }),

  body("eliminados")
    .optional()
    .isArray()
    .withMessage("eliminados debe ser una lista de ids"),
  body("eliminados.*").optional().isInt({ min: 1 }),
];

module.exports = {
  getDashboardValidation,
  compararValidation,
  getCapturaValidation,
  getAvanceValidation,
  guardarCapturaValidation,
};
