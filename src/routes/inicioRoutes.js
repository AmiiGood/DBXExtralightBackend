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

module.exports = router;
