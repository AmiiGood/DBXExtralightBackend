const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { authenticate } = require("../middlewares/auth");
const { body } = require("express-validator");
const { validationResult } = require("express-validator");

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

/**
 * @route   POST /api/auth/login
 * @desc    Login de usuario
 * @access  Public
 */
router.post(
  "/login",
  [
    body("nombreUsuario")
      .trim()
      .notEmpty()
      .withMessage("El nombre de usuario es requerido"),
    body("password").notEmpty().withMessage("La contraseña es requerida"),
  ],
  handleValidationErrors,
  authController.login,
);

/**
 * @route   GET /api/auth/me
 * @desc    Obtener información del usuario actual
 * @access  Private
 */
router.get("/me", authenticate, authController.getProfile);

/**
 * @route   POST /api/auth/change-password
 * @desc    Cambiar contraseña del usuario actual
 * @access  Private
 */
router.post(
  "/change-password",
  authenticate,
  [
    body("passwordActual")
      .notEmpty()
      .withMessage("La contraseña actual es requerida"),
    body("passwordNueva")
      .isLength({ min: 6 })
      .withMessage("La nueva contraseña debe tener al menos 6 caracteres"),
  ],
  handleValidationErrors,
  authController.changePassword,
);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout de usuario
 * @access  Private
 */
router.post("/logout", authenticate, authController.logout);

/**
 * @route   GET /api/auth/modulos
 * @desc    Obtener módulos accesibles para el usuario
 * @access  Private
 */
router.get("/modulos", authenticate, authController.getModulos);

module.exports = router;
