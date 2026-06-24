const { body, param, query } = require("express-validator");

/**
 * Validación para crear usuario
 */
const createUserValidation = [
  body("nombreUsuario")
    .trim()
    .notEmpty()
    .withMessage("El nombre de usuario es requerido")
    .isLength({ min: 3, max: 50 })
    .withMessage("El nombre de usuario debe tener entre 3 y 50 caracteres")
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage(
      "El nombre de usuario solo puede contener letras, números, guiones y guiones bajos"
    ),

  body("email")
    .trim()
    .notEmpty()
    .withMessage("El email es requerido")
    .isEmail()
    .withMessage("Debe ser un email válido")
    .normalizeEmail(),

  body("password")
    .isLength({ min: 6 })
    .withMessage("La contraseña debe tener al menos 6 caracteres"),

  body("nombreCompleto")
    .trim()
    .notEmpty()
    .withMessage("El nombre completo es requerido")
    .isLength({ min: 3, max: 255 })
    .withMessage("El nombre completo debe tener entre 3 y 255 caracteres"),

  body("rolId")
    .notEmpty()
    .withMessage("El rol es requerido")
    .isInt()
    .withMessage("El rol debe ser un número entero"),

  body("areaId")
    .notEmpty()
    .withMessage("El área es requerida")
    .isInt()
    .withMessage("El ID del área debe ser un número entero"),
];

/**
 * Validaciones para actualizar usuario
 */
const updateUserValidation = [
  body("nombreUsuario")
    .optional()
    .trim()
    .isLength({ min: 3 })
    .withMessage("El nombre de usuario debe tener al menos 3 caracteres")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "El nombre de usuario solo puede contener letras, números y guiones bajos"
    ),
  body("email")
    .optional()
    .trim()
    .isEmail()
    .withMessage("Email inválido")
    .normalizeEmail(),
  body("nombreCompleto")
    .optional()
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage("El nombre completo debe tener entre 3 y 255 caracteres"),
  body("rolId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del rol debe ser un número entero positivo"),
  body("areaId")
    .optional()
    .isInt({ min: 1 })
    .withMessage("El ID del área debe ser un número válido"),
  body("activo")
    .optional()
    .isBoolean()
    .withMessage("El campo activo debe ser un booleano"),
];

/**
 * Validaciones para resetear contraseña
 */
const resetPasswordValidation = [
  body("nuevaPassword")
    .isLength({ min: 6 })
    .withMessage("La contraseña debe tener al menos 6 caracteres")
    .notEmpty()
    .withMessage("La nueva contraseña es requerida"),
];

module.exports = {
  createUserValidation,
  updateUserValidation,
  resetPasswordValidation,
};
