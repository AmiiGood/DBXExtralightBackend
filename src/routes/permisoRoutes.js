const express = require("express");
const router = express.Router();
const permisoController = require("../controllers/permisoController");
const { authenticate, isAdmin } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  getPermisosRolValidation,
  updatePermisosRolValidation,
  updatePermisoModuloValidation,
  copiarPermisosValidation,
  verificarPermisoValidation,
} = require("../validators/permisoValidator");

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

// Todas las rutas requieren autenticación
router.use(authenticate);

/**
 * @route   GET /api/permisos/verificar
 * @desc    Verificar si el usuario actual tiene un permiso específico
 * @query   ?ruta=/admin/usuarios&permiso=puede_editar
 * @access  Private
 */
router.get(
  "/verificar",
  verificarPermisoValidation,
  handleValidationErrors,
  permisoController.verificarMiPermiso,
);

// Las siguientes rutas requieren ser administrador
router.use(isAdmin);

/**
 * @route   GET /api/permisos/modulos
 * @desc    Obtener todos los módulos del sistema
 * @query   ?activo=true
 * @access  Private (Admin)
 */
router.get("/modulos", permisoController.getModulos);

/**
 * @route   GET /api/permisos/roles/:rolId
 * @desc    Obtener permisos de un rol específico
 * @access  Private (Admin)
 */
router.get(
  "/roles/:rolId",
  getPermisosRolValidation,
  handleValidationErrors,
  permisoController.getPermisosRol,
);

/**
 * @route   PUT /api/permisos/roles/:rolId
 * @desc    Actualizar todos los permisos de un rol
 * @access  Private (Admin)
 */
router.put(
  "/roles/:rolId",
  updatePermisosRolValidation,
  handleValidationErrors,
  permisoController.updatePermisosRol,
);

/**
 * @route   PUT /api/permisos/roles/:rolId/modulos/:moduloId
 * @desc    Actualizar un permiso específico de un rol para un módulo
 * @access  Private (Admin)
 */
router.put(
  "/roles/:rolId/modulos/:moduloId",
  updatePermisoModuloValidation,
  handleValidationErrors,
  permisoController.updatePermisoModulo,
);

/**
 * @route   POST /api/permisos/copiar
 * @desc    Copiar permisos de un rol a otro
 * @access  Private (Admin)
 */
router.post(
  "/copiar",
  copiarPermisosValidation,
  handleValidationErrors,
  permisoController.copiarPermisosRol,
);

module.exports = router;
