const express = require("express");
const router = express.Router();
const controller = require("../controllers/firmasController");
const { authenticate } = require("../middlewares/auth");

// Firmas: no piden módulo. Lo de cada quien es suyo; listar y quitar las de
// otros es solo del administrador (lo revisa el controlador).

/**
 * @route   GET /api/firmas/mia
 * @desc    Si el usuario tiene firma registrada, con la imagen
 */
router.get("/mia", authenticate, controller.getMia);

/**
 * @route   POST /api/firmas/mia   { imagen, pin, password }
 * @desc    Registrar o cambiar la firma (pide la contraseña del DBX)
 */
router.post("/mia", authenticate, controller.postMia);

/**
 * @route   POST /api/firmas/probar   { pin }
 * @desc    Revisar el PIN sin firmar nada (cuenta como intento)
 */
router.post("/probar", authenticate, controller.postProbar);

/**
 * @route   GET /api/firmas
 * @desc    Quién tiene firma registrada (admin)
 */
router.get("/", authenticate, controller.getTodas);

/**
 * @route   DELETE /api/firmas/usuario/:id
 * @desc    Quitar la firma de alguien para que la registre de nuevo (admin)
 */
router.delete("/usuario/:id", authenticate, controller.deleteDeUsuario);

module.exports = router;
