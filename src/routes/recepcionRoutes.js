const express = require("express");
const router = express.Router();
const recepcionController = require("../controllers/recepcionController");
const { authenticate, verificarPermiso } = require("../middlewares/auth");

router.use(authenticate);
const perm = (accion) => verificarPermiso("Recepción Cajas", accion);

router.post("/cajas/escanear", perm("crear"), recepcionController.escanearCaja);
router.post("/cajas/:cajaId/pares", perm("crear"), recepcionController.escanearPar);
router.get("/cajas/:cajaId/pares", perm("leer"), recepcionController.getPares);
router.get("/reportes", perm("leer"), recepcionController.getReporte);
router.get("/reportes/excel", perm("leer"), recepcionController.exportExcel);
router.get("/reportes/pdf", perm("leer"), recepcionController.exportPDF);

module.exports = router;
