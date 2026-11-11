const express = require("express");
const router = express.Router();
const controller = require("../controllers/inicioController");
const { authenticate } = require("../middlewares/auth");

/**
 * @route   GET /api/inicio
 * @desc    Pendientes del usuario y, para el administrador, el estado de las
 *          sincronizaciones. No pide módulo: Inicio es para todos y cada dato
 *          se filtra por lo que el usuario puede abrir.
 */
router.get("/", authenticate, controller.getInicio);

/**
 * @route   GET /api/inicio/adornos
 * @desc    ¿Se muestran los adornos de temporada? Sin sesión: la pantalla de
 *          inicio de sesión también los enseña.
 */
router.get("/adornos", controller.getAdornos);

/**
 * @route   PUT /api/inicio/adornos  { activos }
 * @desc    Encender o apagar los adornos para todos (solo administradores;
 *          lo revisa el controlador)
 */
router.put("/adornos", authenticate, controller.putAdornos);

module.exports = router;
