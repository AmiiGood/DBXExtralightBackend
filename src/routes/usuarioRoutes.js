const express = require("express");
const router = express.Router();
const usuarioController = require("../controllers/usuarioController");
const { authenticate, isAdmin } = require("../middlewares/auth");
const { validationResult } = require("express-validator");
const {
  createUserValidation,
  updateUserValidation,
  resetPasswordValidation,
} = require("../validators/usuarioValidator");

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

/**
 * @route   GET /api/usuarios/roles
 * @desc    Obtener todos los roles disponibles
 * @access  Private (Admin)
 */
router.get("/roles", usuarioController.getRoles);

/**
 * @route   GET /api/usuarios/areas
 * @desc    Obtener todas las áreas disponibles
 * @access  Private (Admin)
 */
router.get("/areas", usuarioController.getAreas);

/**
 * @route   GET /api/usuarios
 * @desc    Obtener todos los usuarios
 * @query   ?activo=true&rolId=1&areaId=2
 * @access  Private (Admin)
 */
router.get("/", usuarioController.getAllUsers);

/**
 * @route   GET /api/usuarios/:id
 * @desc    Obtener un usuario por ID
 * @access  Private (Admin)
 */
router.get("/:id", usuarioController.getUserById);

/**
 * @route   POST /api/usuarios
 * @desc    Crear un nuevo usuario
 * @access  Private (Admin)
 */
router.post(
  "/",
  createUserValidation,
  handleValidationErrors,
  usuarioController.createUser
);

/**
 * @route   PUT /api/usuarios/:id
 * @desc    Actualizar un usuario
 * @access  Private (Admin)
 */
router.put(
  "/:id",
  updateUserValidation,
  handleValidationErrors,
  usuarioController.updateUser
);

/**
 * @route   PATCH /api/usuarios/:id/desactivar
 * @desc    Desactivar un usuario
 * @access  Private (Admin)
 */
router.patch("/:id/desactivar", usuarioController.deactivateUser);

/**
 * @route   PATCH /api/usuarios/:id/activar
 * @desc    Activar un usuario
 * @access  Private (Admin)
 */
router.patch("/:id/activar", usuarioController.activateUser);

/**
 * @route   POST /api/usuarios/:id/reset-password
 * @desc    Resetear contraseña de un usuario
 * @access  Private (Admin)
 */
router.post(
  "/:id/reset-password",
  resetPasswordValidation,
  handleValidationErrors,
  usuarioController.resetPassword
);

module.exports = router;
