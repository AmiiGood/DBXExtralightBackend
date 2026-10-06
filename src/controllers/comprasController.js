const fs = require("fs");
const Solicitud = require("../models/CompraSolicitud");
const archivosCompras = require("../services/comprasArchivos.service");
const envio = require("../services/enviarCompras.service");
const avisos = require("../services/avisosCompras.service");
const Reporte = require("../models/CompraReporte");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");
const { registrarLog, obtenerIP, obtenerUserAgent } = require("../utils/logger");

const MODULO_LOG = "Solicitudes de Compra";
const RUTA_MODULO = "/compras/solicitudes";

const ASUNTO_MAX = 200;
const DETALLE_MAX = 5000;

function idDe(valor) {
  const id = parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("Id inválido", 400);
  return id;
}

function log(req, accion, descripcion, registroId) {
  return registrarLog({
    usuarioId: req.usuario.id,
    accion,
    modulo: MODULO_LOG,
    tablaAfectada: "compras_solicitudes",
    registroId,
    descripcion,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
}

// =============================================
// SOLICITUDES
// =============================================

/**
 * GET /api/compras/contexto
 *
 * Lo que la pantalla necesita saber del usuario antes de pintar nada: a qué
 * área pide, quién le aprueba, si él aprueba algo y cuánto le espera.
 */
const getContexto = catchAsync(async (req, res) => {
  const [area, aprueba, correoEnOsticket] = await Promise.all([
    Solicitud.areaDelUsuario(req.usuario.id),
    Solicitud.areasQueAprueba(req.usuario.id),
    // A este correo le contesta Compras: si osTicket no lo conoce, se avisa
    envio.correoEnOsticket(req.usuario.email),
  ]);
  const pendientes = aprueba.length ? await Solicitud.contarPendientes(req.usuario.id) : 0;

  sendSuccess(res, 200, {
    area,
    puedePedir: Boolean(area?.activo && area?.gerente_id),
    aprueba,
    pendientes,
    correo: req.usuario.email,
    correoEnOsticket,
    conexionOsticket: envio.configurado(),
    archivos: {
      maxMb: archivosCompras.MAX_MB,
      maxTotalMb: archivosCompras.MAX_TOTAL_MB,
      maxArchivos: archivosCompras.MAX_ARCHIVOS,
      extensiones: archivosCompras.EXTENSIONES,
    },
  });
});

/**
 * GET /api/compras/solicitudes?vista=mias|pendientes|decididas
 */
const getSolicitudes = catchAsync(async (req, res) => {
  const vista = req.query.vista || "mias";
  let filas;
  if (vista === "mias") {
    const estado = req.query.estado?.toUpperCase();
    if (estado && !Solicitud.ESTADOS.includes(estado)) {
      throw new AppError(`Estado no válido: "${req.query.estado}"`, 400);
    }
    filas = await Solicitud.listarMias(req.usuario.id, { estado });
  } else if (vista === "pendientes" || vista === "decididas") {
    filas = await Solicitud.listarBandeja(req.usuario.id, { vista });
  } else {
    throw new AppError(`Vista no válida: "${vista}"`, 400);
  }
  sendSuccess(res, 200, filas);
});

/**
 * POST /api/compras/solicitudes   (multipart: asunto, detalle, archivos[])
 */
const postSolicitud = catchAsync(async (req, res) => {
  const asunto = (req.body.asunto || "").trim();
  const detalle = (req.body.detalle || "").trim();

  try {
    if (!asunto) throw new AppError("Escribe el asunto", 400);
    if (asunto.length > ASUNTO_MAX) {
      throw new AppError(`El asunto puede tener hasta ${ASUNTO_MAX} caracteres`, 400);
    }
    if (!detalle) throw new AppError("Escribe el detalle de lo que necesitas", 400);
    if (detalle.length > DETALLE_MAX) {
      throw new AppError(`El detalle puede tener hasta ${DETALLE_MAX} caracteres`, 400);
    }
    const excede = archivosCompras.excedeTotal(req.files);
    if (excede) throw new AppError(excede, 400);

    const creada = await Solicitud.crear(
      req.usuario,
      { asunto, detalle },
      archivosCompras.describir(req.files),
    );

    await log(
      req,
      "INSERT",
      `Solicitud ${creada.folio} para ${creada.area}` +
        (creada.estado === "APROBADA" ? " (la pidió el gerente: aprobada)" : ""),
      creada.id,
    );
    // Pendiente: avisar a quien aprueba. Si la pidió el gerente ya va aprobada
    // y el aviso útil es el de "ya está en Compras", que sale al crear el ticket.
    if (creada.estado === "PENDIENTE") avisos.enSegundoPlano(avisos.avisarNueva, creada.id);
    else envio.enviarEnSegundoPlano(creada.id);
    sendSuccess(res, 201, creada, `Solicitud ${creada.folio} enviada`);
  } catch (error) {
    // Sin solicitud, los archivos quedarían huérfanos en disco
    archivosCompras.borrar(req.files);
    throw error;
  }
});

/**
 * GET /api/compras/solicitudes/:id
 */
const getSolicitud = catchAsync(async (req, res) => {
  sendSuccess(res, 200, await Solicitud.obtener(idDe(req.params.id), req.usuario));
});

/**
 * GET /api/compras/solicitudes/:id/archivos/:archivoId
 *
 * `?descargar=1` lo baja como adjunto; si no, se manda en línea para que las
 * imágenes y los PDF se puedan ver en el navegador.
 */
const getArchivo = catchAsync(async (req, res) => {
  const archivo = await Solicitud.obtenerArchivo(
    idDe(req.params.id),
    idDe(req.params.archivoId),
    req.usuario,
  );
  const ruta = archivosCompras.rutaAbsoluta(archivo.ruta);
  if (!fs.existsSync(ruta)) {
    throw new AppError("El archivo ya no está en el servidor", 410);
  }
  const disposicion = req.query.descargar ? "attachment" : "inline";
  res.setHeader("Content-Type", archivo.tipo_mime);
  res.setHeader(
    "Content-Disposition",
    `${disposicion}; filename*=UTF-8''${encodeURIComponent(archivo.nombre_original)}`,
  );
  // Helmet bloquea por omisión que otro origen (el frontend) lea el archivo
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  fs.createReadStream(ruta).pipe(res);
});

/**
 * POST /api/compras/solicitudes/:id/decision   { aprobar: bool, comentario }
 *
 * El permiso NO sale del rol: lo revisa el modelo contra el gerente y el
 * suplente del área.
 */
const postDecision = catchAsync(async (req, res) => {
  const id = idDe(req.params.id);
  if (typeof req.body.aprobar !== "boolean") {
    throw new AppError("Falta indicar si se aprueba o se rechaza", 400);
  }
  const resultado = await Solicitud.decidir(id, req.usuario, {
    aprobar: req.body.aprobar,
    comentario: req.body.comentario,
  });
  const verbo = resultado.estado === "APROBADA" ? "aprobada" : "rechazada";
  await log(req, "UPDATE", `Solicitud ${resultado.folio} ${verbo}`, id);
  // El ticket se crea después de responder: el gerente no espera a osTicket.
  // Al solicitante: el rechazo de inmediato; la aprobación, con el número de
  // ticket cuando llegue a Compras, o ya mismo si no hay conexión.
  if (resultado.estado === "RECHAZADA") {
    avisos.enSegundoPlano(avisos.avisarRechazada, id);
  } else if (envio.configurado()) {
    envio.enviarEnSegundoPlano(id);
  } else {
    avisos.enSegundoPlano(avisos.avisarAprobada, id);
  }
  sendSuccess(res, 200, resultado, `Solicitud ${resultado.folio} ${verbo}`);
});

/**
 * POST /api/compras/solicitudes/:id/cancelar
 */
const postCancelar = catchAsync(async (req, res) => {
  const id = idDe(req.params.id);
  const resultado = await Solicitud.cancelar(id, req.usuario);
  await log(req, "UPDATE", `Solicitud ${resultado.folio} cancelada por quien la pidió`, id);
  sendSuccess(res, 200, resultado, `Solicitud ${resultado.folio} cancelada`);
});

// =============================================
// ENVÍO A osTicket
// =============================================

/**
 * GET /api/compras/envios
 *
 * A dónde apunta la conexión y qué aprobadas no han llegado a Compras.
 */
const getEnvios = catchAsync(async (req, res) => {
  sendSuccess(res, 200, {
    conexion: envio.estadoConexion(),
    porEnviar: await Solicitud.listarPorEnviar(),
  });
});

/**
 * POST /api/compras/solicitudes/:id/reenviar
 *
 * Reintento a mano, sin respetar el tope de intentos automáticos. Espera la
 * respuesta de osTicket para decir en pantalla si llegó.
 */
const postReenviar = catchAsync(async (req, res) => {
  const id = idDe(req.params.id);
  if (!envio.configurado()) {
    throw new AppError("La conexión con osTicket no está configurada en el servidor", 409);
  }
  const r = await envio.enviar(id, { forzar: true });
  if (r.omitido) {
    throw new AppError("La solicitud no está esperando envío, o ya se está mandando", 409);
  }
  await log(req, "UPDATE", `Reenvío a osTicket: ${r.ok ? r.numero : r.error}`, id);
  if (!r.ok) throw new AppError(r.error, 502);
  sendSuccess(res, 200, r, `Ticket ${r.numero} creado en Compras`);
});

// =============================================
// AVISOS POR CORREO
// =============================================

/**
 * GET /api/compras/avisos
 */
const getAvisos = catchAsync(async (req, res) => {
  const [config, correos] = await Promise.all([avisos.leerConfig(), avisos.ultimosCorreos()]);
  sendSuccess(res, 200, {
    config,
    horario: avisos.describirHorario(config),
    // Sin SMTP real (Mailpit o Ethereal) los correos no llegan a buzones
    servidor: process.env.SMTP_HOST ? `${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}` : null,
    correos,
  });
});

/**
 * PUT /api/compras/avisos
 *   { avisosActivos, avisoInmediato, recordatorioHoras: ['09:00'], recordatorioDias: [1..5] }
 */
const putAvisos = catchAsync(async (req, res) => {
  let config;
  try {
    config = await avisos.guardarConfig(req.body || {}, req.usuario.id);
  } catch (error) {
    throw new AppError(error.message, 400);
  }
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Aprobadores de Compras",
    tablaAfectada: "compras_config",
    descripcion: `Avisos de Compras: ${config.avisos_activos ? avisos.describirHorario(config) : "apagados"}`,
    datosNuevos: config,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, { config, horario: avisos.describirHorario(config) }, "Avisos guardados");
});

/**
 * POST /api/compras/avisos/prueba
 * Correo de prueba a quien lo pide.
 */
const postAvisoPrueba = catchAsync(async (req, res) => {
  const r = await avisos.mandarPrueba(req.usuario);
  if (!r.ok) throw new AppError(r.error || `No se pudo mandar a ${req.usuario.email || "(sin correo)"}`, 502);
  sendSuccess(res, 200, r, `Correo de prueba enviado a ${req.usuario.email}`);
});

/**
 * POST /api/compras/avisos/recordatorios
 * Manda ya el recordatorio a todos los aprobadores con pendientes.
 */
const postRecordatorios = catchAsync(async (req, res) => {
  const r = await avisos.mandarRecordatorios({ forzar: true });
  sendSuccess(
    res,
    200,
    r,
    r.aprobadores === 0
      ? "Nadie tiene solicitudes pendientes: no se mandó nada"
      : `Recordatorio enviado a ${r.enviados} de ${r.aprobadores} aprobador(es)`,
  );
});

// =============================================
// REPORTE
// =============================================

/** AAAA-MM-DD que además exista: "2026-02-30" pasa el formato pero no es fecha. */
function esFecha(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * GET /api/compras/reportes?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 */
const getReporte = catchAsync(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!esFecha(desde) || !esFecha(hasta)) {
    throw new AppError("Las fechas van como AAAA-MM-DD", 400);
  }
  if (desde > hasta) throw new AppError("La fecha inicial es posterior a la final", 400);
  const periodo = { desde, hasta };
  const [resumen, porArea, semanal, pendientes, rechazos] = await Promise.all([
    Reporte.resumen(periodo),
    Reporte.porArea(periodo),
    Reporte.semanal(periodo),
    Reporte.pendientesAhora(),
    Reporte.rechazos(periodo),
  ]);
  sendSuccess(res, 200, { periodo, resumen, porArea, semanal, pendientes, rechazos });
});

// =============================================
// APROBADORES
// =============================================

/**
 * GET /api/compras/aprobadores
 */
const getAprobadores = catchAsync(async (req, res) => {
  const [areas, areasDbx, usuarios] = await Promise.all([
    Solicitud.listarAreas(),
    Solicitud.listarAreasDbx(),
    Solicitud.usuariosParaAprobar(RUTA_MODULO),
  ]);
  sendSuccess(res, 200, { areas, areasDbx, usuarios });
});

/**
 * PUT /api/compras/aprobadores/areas/:id   { gerenteId, suplenteId, activo }
 */
const putArea = catchAsync(async (req, res) => {
  const id = idDe(req.params.id);
  const { gerenteId, suplenteId, activo } = req.body;
  const area = await Solicitud.actualizarArea(
    id,
    {
      gerenteId: gerenteId ? idDe(gerenteId) : null,
      suplenteId: suplenteId ? idDe(suplenteId) : null,
      activo,
    },
    req.usuario.id,
  );
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Aprobadores de Compras",
    tablaAfectada: "compras_areas",
    registroId: id,
    descripcion: `Aprobadores de "${area.nombre}" actualizados`,
    datosNuevos: area,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, area, "Área actualizada");
});

/**
 * PUT /api/compras/aprobadores/areas-dbx/:id   { comprasAreaId }
 */
const putAreaDbx = catchAsync(async (req, res) => {
  const id = idDe(req.params.id);
  const comprasAreaId = req.body.comprasAreaId ? idDe(req.body.comprasAreaId) : null;
  const area = await Solicitud.ligarAreaDbx(id, comprasAreaId);
  await registrarLog({
    usuarioId: req.usuario.id,
    accion: "UPDATE",
    modulo: "Aprobadores de Compras",
    tablaAfectada: "areas",
    registroId: id,
    descripcion: `Área "${area.nombre}" ligada al área de Compras ${comprasAreaId ?? "(ninguna)"}`,
    ipAddress: obtenerIP(req),
    userAgent: obtenerUserAgent(req),
  });
  sendSuccess(res, 200, area, "Área actualizada");
});

module.exports = {
  getContexto,
  getSolicitudes,
  postSolicitud,
  getSolicitud,
  getArchivo,
  postDecision,
  postCancelar,
  getEnvios,
  postReenviar,
  getAvisos,
  putAvisos,
  postAvisoPrueba,
  postRecordatorios,
  getReporte,
  getAprobadores,
  putArea,
  putAreaDbx,
};
