const express = require("express");
const router = express.Router();
const catalogoController = require("../controllers/catalogoController");
const { authenticate, isAdmin } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  createTurnoValidation,
  updateTurnoValidation,
  createAreaProduccionValidation,
  updateAreaProduccionValidation,
  createTipoDefectoValidation,
  updateTipoDefectoValidation,
  createRolValidation,
  updateRolValidation,
  createAreaValidation,
  updateAreaValidation,
  idParamValidation,
} = require("../validators/catalogoValidator");

// Middleware para manejar errores de validación
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

// Todas las rutas requieren autenticación y ser administrador
router.use(authenticate);
router.use(isAdmin);

// =====================
// TURNOS
// =====================

/**
 * @route   GET /api/catalogos/turnos
 * @desc    Obtener todos los turnos
 * @query   ?activo=true
 * @access  Private (Admin)
 */
router.get("/turnos", catalogoController.getTurnos);

/**
 * @route   GET /api/catalogos/turnos/:id
 * @desc    Obtener un turno por ID
 * @access  Private (Admin)
 */
router.get(
  "/turnos/:id",
  idParamValidation,
  handleValidationErrors,
  catalogoController.getTurnoById,
);

/**
 * @route   POST /api/catalogos/turnos
 * @desc    Crear un nuevo turno
 * @access  Private (Admin)
 */
router.post(
  "/turnos",
  createTurnoValidation,
  handleValidationErrors,
  catalogoController.createTurno,
);

/**
 * @route   PUT /api/catalogos/turnos/:id
 * @desc    Actualizar un turno
 * @access  Private (Admin)
 */
router.put(
  "/turnos/:id",
  updateTurnoValidation,
  handleValidationErrors,
  catalogoController.updateTurno,
);

// =====================
// ÁREAS DE PRODUCCIÓN
// =====================

/**
 * @route   GET /api/catalogos/areas-produccion
 * @desc    Obtener todas las áreas de producción
 * @query   ?activo=true
 * @access  Private (Admin)
 */
router.get("/areas-produccion", catalogoController.getAreasProduccion);

/**
 * @route   GET /api/catalogos/areas-produccion/:id
 * @desc    Obtener un área de producción por ID
 * @access  Private (Admin)
 */
router.get(
  "/areas-produccion/:id",
  idParamValidation,
  handleValidationErrors,
  catalogoController.getAreaProduccionById,
);

/**
 * @route   POST /api/catalogos/areas-produccion
 * @desc    Crear una nueva área de producción
 * @access  Private (Admin)
 */
router.post(
  "/areas-produccion",
  createAreaProduccionValidation,
  handleValidationErrors,
  catalogoController.createAreaProduccion,
);

/**
 * @route   PUT /api/catalogos/areas-produccion/:id
 * @desc    Actualizar un área de producción
 * @access  Private (Admin)
 */
router.put(
  "/areas-produccion/:id",
  updateAreaProduccionValidation,
  handleValidationErrors,
  catalogoController.updateAreaProduccion,
);

// =====================
// TIPOS DE DEFECTOS
// =====================

/**
 * @route   GET /api/catalogos/tipos-defectos
 * @desc    Obtener todos los tipos de defectos
 * @query   ?activo=true&search=texto
 * @access  Private (Admin)
 */
router.get("/tipos-defectos", catalogoController.getTiposDefectos);

/**
 * @route   GET /api/catalogos/tipos-defectos/:id
 * @desc    Obtener un tipo de defecto por ID
 * @access  Private (Admin)
 */
router.get(
  "/tipos-defectos/:id",
  idParamValidation,
  handleValidationErrors,
  catalogoController.getTipoDefectoById,
);

/**
 * @route   POST /api/catalogos/tipos-defectos
 * @desc    Crear un nuevo tipo de defecto
 * @access  Private (Admin)
 */
router.post(
  "/tipos-defectos",
  createTipoDefectoValidation,
  handleValidationErrors,
  catalogoController.createTipoDefecto,
);

/**
 * @route   PUT /api/catalogos/tipos-defectos/:id
 * @desc    Actualizar un tipo de defecto
 * @access  Private (Admin)
 */
router.put(
  "/tipos-defectos/:id",
  updateTipoDefectoValidation,
  handleValidationErrors,
  catalogoController.updateTipoDefecto,
);

// =====================
// ROLES
// =====================

/**
 * @route   GET /api/catalogos/roles
 * @desc    Obtener todos los roles
 * @query   ?activo=true
 * @access  Private (Admin)
 */
router.get("/roles", catalogoController.getRoles);

/**
 * @route   GET /api/catalogos/roles/:id
 * @desc    Obtener un rol por ID (incluye permisos)
 * @access  Private (Admin)
 */
router.get(
  "/roles/:id",
  idParamValidation,
  handleValidationErrors,
  catalogoController.getRolById,
);

/**
 * @route   POST /api/catalogos/roles
 * @desc    Crear un nuevo rol
 * @access  Private (Admin)
 */
router.post(
  "/roles",
  createRolValidation,
  handleValidationErrors,
  catalogoController.createRol,
);

/**
 * @route   PUT /api/catalogos/roles/:id
 * @desc    Actualizar un rol
 * @access  Private (Admin)
 */
router.put(
  "/roles/:id",
  updateRolValidation,
  handleValidationErrors,
  catalogoController.updateRol,
);

// =====================
// ÁREAS (DEPARTAMENTOS)
// =====================

/**
 * @route   GET /api/catalogos/areas
 * @desc    Obtener todas las áreas
 * @query   ?activo=true
 * @access  Private (Admin)
 */
router.get("/areas", catalogoController.getAreas);

/**
 * @route   GET /api/catalogos/areas/:id
 * @desc    Obtener un área por ID
 * @access  Private (Admin)
 */
router.get(
  "/areas/:id",
  idParamValidation,
  handleValidationErrors,
  catalogoController.getAreaById,
);

/**
 * @route   POST /api/catalogos/areas
 * @desc    Crear una nueva área
 * @access  Private (Admin)
 */
router.post(
  "/areas",
  createAreaValidation,
  handleValidationErrors,
  catalogoController.createArea,
);

/**
 * @route   PUT /api/catalogos/areas/:id
 * @desc    Actualizar un área
 * @access  Private (Admin)
 */
router.put(
  "/areas/:id",
  updateAreaValidation,
  handleValidationErrors,
  catalogoController.updateArea,
);

module.exports = router;
