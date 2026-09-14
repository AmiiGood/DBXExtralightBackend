const express = require("express");
const router = express.Router();
const { validationResult } = require("express-validator");
const ctrl = require("../controllers/envioReportesController");
const v = require("../validators/envioReportesValidator");
const { authenticate } = require("../middlewares/auth");
const {
  puedeLeer,
  puedeCrear,
  puedeEditar,
  puedeEliminar,
} = require("../middlewares/permisos");

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: "error",
      message: "Errores de validación",
      errors: errors.array(),
    });
  }
  next();
};

const MODULO = "/admin/envio-reportes";

// Todo el módulo requiere sesión
router.use(authenticate);

// =============================================
// LISTAS DE CORREO
// =============================================

router.get("/listas", puedeLeer(MODULO), ctrl.getListas);
router.get("/listas/:id", puedeLeer(MODULO), ctrl.getLista);

router.post(
  "/listas",
  puedeCrear(MODULO),
  v.crearListaValidation,
  handleValidationErrors,
  ctrl.crearLista,
);

router.put(
  "/listas/:id",
  puedeEditar(MODULO),
  v.actualizarListaValidation,
  handleValidationErrors,
  ctrl.actualizarLista,
);

router.delete("/listas/:id", puedeEliminar(MODULO), ctrl.eliminarLista);

// ------------------------------- destinatarios de una lista

router.post(
  "/listas/:id/miembros",
  puedeEditar(MODULO),
  v.miembroValidation,
  handleValidationErrors,
  ctrl.agregarMiembro,
);

router.put("/miembros/:miembroId", puedeEditar(MODULO), ctrl.actualizarMiembro);
router.delete("/miembros/:miembroId", puedeEditar(MODULO), ctrl.eliminarMiembro);

// =============================================
// PROGRAMACIONES
// =============================================

router.get("/programaciones", puedeLeer(MODULO), ctrl.getProgramaciones);

router.post(
  "/programaciones",
  puedeCrear(MODULO),
  v.programacionValidation,
  handleValidationErrors,
  ctrl.crearProgramacion,
);

router.put(
  "/programaciones/:id",
  puedeEditar(MODULO),
  v.programacionValidation,
  handleValidationErrors,
  ctrl.actualizarProgramacion,
);

router.delete(
  "/programaciones/:id",
  puedeEliminar(MODULO),
  ctrl.eliminarProgramacion,
);

/**
 * Dispara la programación al instante. Requiere permiso de creación porque
 * manda correo de verdad, no es una consulta.
 */
router.post(
  "/programaciones/:id/probar",
  puedeCrear(MODULO),
  ctrl.probarProgramacion,
);

// =============================================
// BITÁCORA Y DIAGNÓSTICO
// =============================================

router.get(
  "/envios",
  puedeLeer(MODULO),
  v.getEnviosValidation,
  handleValidationErrors,
  ctrl.getEnvios,
);

router.get("/probar-conexion", puedeLeer(MODULO), ctrl.probarConexion);

module.exports = router;
