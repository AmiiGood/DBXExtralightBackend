const express = require("express");
const router = express.Router();
const controller = require("../controllers/comprasController");
const cotizaciones = require("../controllers/cotizacionesComprasController");
const { authenticate } = require("../middlewares/auth");
const { puedeLeer, puedeCrear, puedeEditar } = require("../middlewares/permisos");
const { recibirArchivos } = require("../services/comprasArchivos.service");

const MODULO = "/compras/solicitudes";
// Configurar quién aprueba es otra cosa que pedir: va por separado
const MODULO_APROBADORES = "/compras/aprobadores";
const MODULO_REPORTES = "/compras/reportes";
// Leer = ver lo asignado; crear = cotizar; editar = ver todo (jefe de Compras).
// Lo de "ver todo" lo resuelve el modelo, aquí basta con leer o crear.
const MODULO_COTIZACIONES = "/compras/cotizaciones";

// =============================================
// SOLICITUDES
//
// Aprobar, rechazar y cancelar solo piden poder abrir el módulo: quién puede
// decidir sale del gerente/suplente del área y quién puede cancelar, de ser el
// solicitante. Eso lo revisa el modelo, no el rol.
// =============================================

/**
 * @route   GET /api/compras/contexto
 * @desc    Área del usuario, quién le aprueba y qué aprueba él
 */
router.get("/contexto", authenticate, puedeLeer(MODULO), controller.getContexto);

/**
 * @route   GET /api/compras/solicitudes?vista=mias|pendientes|decididas
 */
router.get("/solicitudes", authenticate, puedeLeer(MODULO), controller.getSolicitudes);

/**
 * @route   POST /api/compras/solicitudes
 * @desc    Nueva solicitud (multipart: asunto, detalle, archivos[])
 */
router.post(
  "/solicitudes",
  authenticate,
  puedeCrear(MODULO),
  recibirArchivos,
  controller.postSolicitud,
);

/**
 * @route   GET /api/compras/solicitudes/:id
 * @desc    Detalle con archivos y bitácora
 */
router.get("/solicitudes/:id", authenticate, puedeLeer(MODULO), controller.getSolicitud);

/**
 * @route   GET /api/compras/solicitudes/:id/archivos/:archivoId
 */
router.get(
  "/solicitudes/:id/archivos/:archivoId",
  authenticate,
  puedeLeer(MODULO),
  controller.getArchivo,
);

/**
 * @route   POST /api/compras/solicitudes/:id/decision
 * @desc    Aprobar o rechazar (gerente o suplente del área)
 */
router.post(
  "/solicitudes/:id/decision",
  authenticate,
  puedeLeer(MODULO),
  controller.postDecision,
);

/**
 * @route   POST /api/compras/solicitudes/:id/cancelar
 * @desc    Quien la pidió la retira mientras está pendiente
 */
router.post(
  "/solicitudes/:id/cancelar",
  authenticate,
  puedeLeer(MODULO),
  controller.postCancelar,
);

// =============================================
// ENVÍO A osTicket
//
// Ver y reintentar los envíos es de quien administra el proceso, no de quien
// pide ni de quien aprueba.
// =============================================

/**
 * @route   GET /api/compras/envios
 * @desc    Estado de la conexión y aprobadas que no han llegado a Compras
 */
router.get("/envios", authenticate, puedeLeer(MODULO_APROBADORES), controller.getEnvios);

/**
 * @route   POST /api/compras/solicitudes/:id/reenviar
 * @desc    Reintenta a mano crear el ticket en osTicket
 */
router.post(
  "/solicitudes/:id/reenviar",
  authenticate,
  puedeEditar(MODULO_APROBADORES),
  controller.postReenviar,
);

// =============================================
// AVISOS POR CORREO (se configuran junto con los aprobadores)
// =============================================

/**
 * @route   GET /api/compras/avisos
 * @desc    Configuración de avisos y últimos correos enviados
 */
router.get("/avisos", authenticate, puedeLeer(MODULO_APROBADORES), controller.getAvisos);

/**
 * @route   PUT /api/compras/avisos
 */
router.put("/avisos", authenticate, puedeEditar(MODULO_APROBADORES), controller.putAvisos);

/**
 * @route   POST /api/compras/avisos/prueba
 * @desc    Correo de prueba al usuario
 */
router.post("/avisos/prueba", authenticate, puedeLeer(MODULO_APROBADORES), controller.postAvisoPrueba);

/**
 * @route   POST /api/compras/avisos/recordatorios
 * @desc    Manda ya los recordatorios (a los aprobadores reales)
 */
router.post(
  "/avisos/recordatorios",
  authenticate,
  puedeEditar(MODULO_APROBADORES),
  controller.postRecordatorios,
);

// =============================================
// REPORTE
// =============================================

/**
 * @route   GET /api/compras/reportes
 * @desc    Tiempos de aprobación y rechazos por área
 */
router.get("/reportes", authenticate, puedeLeer(MODULO_REPORTES), controller.getReporte);

// =============================================
// APROBADORES
// =============================================

/**
 * @route   GET /api/compras/aprobadores
 * @desc    Áreas de Compras con gerente y suplente, áreas de DBX y usuarios
 */
router.get(
  "/aprobadores",
  authenticate,
  puedeLeer(MODULO_APROBADORES),
  controller.getAprobadores,
);

/**
 * @route   PUT /api/compras/aprobadores/areas/:id
 */
router.put(
  "/aprobadores/areas/:id",
  authenticate,
  puedeEditar(MODULO_APROBADORES),
  controller.putArea,
);

/**
 * @route   PUT /api/compras/aprobadores/areas-dbx/:id
 */
router.put(
  "/aprobadores/areas-dbx/:id",
  authenticate,
  puedeEditar(MODULO_APROBADORES),
  controller.putAreaDbx,
);

// =============================================
// COTIZACIONES
//
// Compras captura las opciones de proveedores y las manda; quien pidió elige.
// Elegir y pedir otras opciones solo piden abrir Solicitudes: que sea quien
// pidió lo revisa el modelo.
// =============================================

/**
 * @route   GET /api/compras/cotizaciones?vista=por-cotizar|esperando|elegidas
 * @desc    Lo que el agente tiene asignado en osTicket (o todo, para el jefe)
 */
router.get("/cotizaciones", authenticate, puedeLeer(MODULO_COTIZACIONES), cotizaciones.getBandeja);

/**
 * @route   GET /api/compras/cotizaciones/:id
 * @desc    La solicitud con su borrador, la cotización enviada y las descartadas
 */
router.get("/cotizaciones/:id", authenticate, puedeLeer(MODULO_COTIZACIONES), cotizaciones.getSolicitud);

/**
 * @route   PUT /api/compras/cotizaciones/:id/borrador
 * @desc    Guarda el comparativo tal como está en pantalla
 */
router.put("/cotizaciones/:id/borrador", authenticate, puedeCrear(MODULO_COTIZACIONES), cotizaciones.putBorrador);

/**
 * @route   POST /api/compras/cotizaciones/:id/archivos
 * @desc    Fotos y PDF de los proveedores (multipart: archivos[])
 */
router.post(
  "/cotizaciones/:id/archivos",
  authenticate,
  puedeCrear(MODULO_COTIZACIONES),
  recibirArchivos,
  cotizaciones.postArchivos,
);

/**
 * @route   POST /api/compras/cotizaciones/:id/enviar
 * @desc    Manda las opciones a quien pidió
 */
router.post("/cotizaciones/:id/enviar", authenticate, puedeCrear(MODULO_COTIZACIONES), cotizaciones.postEnviar);

/**
 * @route   GET /api/compras/cotizaciones/:id/solicitud-archivos/:archivoId
 * @desc    Un adjunto de la solicitud, visto desde Compras
 */
router.get(
  "/cotizaciones/:id/solicitud-archivos/:archivoId",
  authenticate,
  puedeLeer(MODULO_COTIZACIONES),
  cotizaciones.getArchivoSolicitud,
);

/**
 * @route   GET /api/compras/cotizacion-archivos/:archivoId
 * @desc    Foto o PDF de un proveedor. Lo ve Compras y, ya enviada, quien pidió:
 *          el acceso lo revisa el modelo
 */
router.get("/cotizacion-archivos/:archivoId", authenticate, cotizaciones.getArchivoCotizacion);

/**
 * @route   POST /api/compras/solicitudes/:id/elegir
 * @desc    Quien pidió elige una opción
 */
router.post("/solicitudes/:id/elegir", authenticate, puedeLeer(MODULO), cotizaciones.postElegir);

/**
 * @route   POST /api/compras/solicitudes/:id/otras-opciones
 * @desc    Ninguna opción le sirve: regresa a Compras
 */
router.post("/solicitudes/:id/otras-opciones", authenticate, puedeLeer(MODULO), cotizaciones.postOtrasOpciones);

module.exports = router;
