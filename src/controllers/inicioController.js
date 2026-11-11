const db = require("../config/database");
const RolModulo = require("../models/RolModulo");
const CompraSolicitud = require("../models/CompraSolicitud");
const CompraCotizacion = require("../models/CompraCotizacion");
const osticket = require("../config/osticket");
const graph = require("../utils/graphClient");
const { esCarpeta } = require("../services/sincronizarSharePoint.service");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");

/**
 * La pantalla de Inicio de cada usuario.
 *
 * Antes todos llegaban al tablero de Calidad, que para casi nadie significaba
 * nada. Ahora Inicio enseña:
 *   - lo que espera al usuario (aprobar, cotizar, elegir), solo de los
 *     módulos que puede abrir;
 *   - para el administrador, cómo van las sincronizaciones automáticas, que
 *     es lo primero que hay que revisar cuando un reporte "no se actualizó".
 *
 * Los reportes y las cargas no salen de aquí: el frontend ya tiene sus índices
 * (config/areas.js y config/cargas.js) y los cruza con /auth/modulos.
 */

/** Cada contador falla por su lado: que uno truene no tumba la pantalla. */
async function seguro(fn, respaldo = null) {
  try {
    return await fn();
  } catch (e) {
    console.error("Inicio:", e.message);
    return respaldo;
  }
}

async function pendientes(usuario, rutas) {
  const lista = [];
  const agregar = (n, texto, ruta) => {
    if (n > 0) lista.push({ n, texto, ruta });
  };

  if (rutas.has("/compras/solicitudes")) {
    const [porAprobar, porElegir] = await Promise.all([
      seguro(() => CompraSolicitud.contarPendientes(usuario.id), 0),
      seguro(() => CompraSolicitud.contarPorElegir(usuario.id), 0),
    ]);
    agregar(porAprobar, porAprobar === 1 ? "solicitud de compra por aprobar" : "solicitudes de compra por aprobar", "/compras/solicitudes");
    agregar(porElegir, porElegir === 1 ? "cotización por revisar" : "cotizaciones por revisar", "/compras/solicitudes");
  }
  if (rutas.has("/compras/cotizaciones")) {
    const c = await seguro(() => CompraCotizacion.contar(usuario), {});
    const n = c?.["por-cotizar"] || 0;
    agregar(n, n === 1 ? "solicitud por cotizar" : "solicitudes por cotizar", "/compras/cotizaciones");
  }
  if (rutas.has("/compras/aprobadores")) {
    const sinTicket = await seguro(async () => (await CompraSolicitud.listarPorEnviar()).length, 0);
    agregar(sinTicket, sinTicket === 1 ? "solicitud aprobada que no llegó a osTicket" : "solicitudes aprobadas que no llegaron a osTicket", "/compras/aprobadores");
  }
  return lista;
}

/**
 * estado: ok | error | apagado | sin-configurar | sin-datos
 * minutos: hace cuántos minutos fue lo último (se calcula en la base para no
 * pelear con la zona horaria)
 */
async function sincronizaciones() {
  const lista = [];

  // Réplicas de osTicket (Moldes y TI): la última corrida que terminó
  for (const [nombre, tabla, ruta] of [
    ["osTicket · Moldes", "moldes_sincronizaciones", "/moldes/reportes"],
    ["osTicket · TI", "ti_sincronizaciones", "/ti/reportes"],
  ]) {
    const fila = await seguro(async () => {
      const { rows } = await db.query(
        `SELECT exito, mensaje, floor(extract(epoch FROM now() - terminada_en) / 60)::int AS minutos
           FROM ${tabla} WHERE terminada_en IS NOT NULL ORDER BY iniciada_en DESC LIMIT 1`,
      );
      return rows[0] || null;
    });
    lista.push({
      nombre,
      ruta,
      estado: !osticket.configurado() ? "sin-configurar" : !fila ? "sin-datos" : fila.exito ? "ok" : "error",
      minutos: fila?.minutos ?? null,
      // Corre cada pocos minutos: si lleva más de una hora sin terminar, algo pasa
      limite: 60,
      que: "última corrida",
      detalle: fila && !fila.exito ? fila.mensaje : null,
    });
  }

  // Archivos vigilados (carpetas de red y SharePoint): uno por renglón
  const archivos = [
    ["Customer Service", "cs_archivos", "/customer-service/archivos", null],
    // SharePoint lee por Graph o de una carpeta sincronizada con OneDrive; un
    // renglón sin ninguna de las dos no tiene de dónde leer
    ["SharePoint", "sp_archivos", "/admin/sharepoint", (f) => !f.ubicacion || (!esCarpeta(f.ubicacion) && !graph.configurado())],
    ["CAPEX", "capex_archivo", "/capex/archivo", null],
    ["AIMS", "aims_archivo", "/aims/archivo", null],
  ];
  for (const [grupo, tabla, ruta, sinConfigurar] of archivos) {
    const filas = await seguro(async () => {
      const { rows } = await db.query(
        `SELECT nombre, activo, ultimo_error, ${tabla === "sp_archivos" ? "ubicacion" : "NULL AS ubicacion"},
                floor(extract(epoch FROM now() - leido_en) / 60)::int AS minutos
           FROM ${tabla} ORDER BY nombre`,
      );
      return rows;
    }, []);
    // Si a ninguno le falta lo mismo, un solo renglón para todo el grupo
    if (filas.length && sinConfigurar && filas.every(sinConfigurar)) {
      lista.push({ nombre: grupo, ruta, estado: "sin-configurar", minutos: null, detalle: null });
      continue;
    }
    for (const f of filas) {
      lista.push({
        nombre: filas.length > 1 || f.nombre !== grupo ? `${grupo} · ${f.nombre}` : grupo,
        ruta,
        estado: sinConfigurar && sinConfigurar(f) ? "sin-configurar"
          : !f.activo ? "apagado" : f.ultimo_error ? "error" : f.minutos == null ? "sin-datos" : "ok",
        minutos: f.minutos,
        // Se lee solo cuando el archivo cambia: que sea viejo no es un error
        que: "último cambio leído",
        detalle: f.ultimo_error || null,
      });
    }
  }

  // Tipo de cambio de Banxico: el último FIX guardado
  const tc = await seguro(async () => {
    const { rows } = await db.query(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, valor::float AS valor,
              floor(extract(epoch FROM now() - obtenido_en) / 60)::int AS minutos
         FROM tipos_cambio WHERE serie = 'SF43718' ORDER BY fecha DESC LIMIT 1`,
    );
    return rows[0] || null;
  });
  lista.push({
    nombre: "Tipo de cambio (Banxico)",
    ruta: "/gasto-q4/reportes",
    estado: !process.env.BANXICO_TOKEN ? "sin-configurar" : !tc ? "sin-datos" : "ok",
    minutos: tc?.minutos ?? null,
    que: "último FIX guardado",
    detalle: tc ? `FIX del ${tc.fecha}: ${tc.valor}` : null,
  });

  return lista;
}

/** GET /api/inicio */
const getInicio = catchAsync(async (req, res) => {
  const u = req.usuario;
  const esAdmin = Boolean(u.rol?.esAdmin);
  const modulos = await RolModulo.getModulosAccesibles(u.rol?.id, esAdmin);
  const rutas = new Set(modulos.map((m) => m.ruta));

  const [lista, sinc] = await Promise.all([pendientes(u, rutas), esAdmin ? sincronizaciones() : null]);
  sendSuccess(res, 200, { pendientes: lista, sincronizaciones: sinc });
});

// =============================================
// ADORNOS DE TEMPORADA
//
// Las fechas viven en el frontend; aquí solo el interruptor general. Si la
// migración de sistema_config no está aplicada, se muestran (es lo normal).
// =============================================

async function adornosActivos() {
  try {
    const { rows } = await db.query("SELECT valor FROM sistema_config WHERE clave = 'adornos_temporada'");
    return rows[0] ? rows[0].valor === true : true;
  } catch {
    return true;
  }
}

/** GET /api/inicio/adornos — público: lo lee también la pantalla de inicio de sesión */
const getAdornos = catchAsync(async (req, res) => {
  sendSuccess(res, 200, { activos: await adornosActivos() });
});

/** PUT /api/inicio/adornos  { activos } — solo administradores */
const putAdornos = catchAsync(async (req, res) => {
  if (!req.usuario.rol?.esAdmin) throw new AppError("Solo un administrador puede cambiar esto", 403);
  const activos = Boolean(req.body?.activos);
  await db.query(
    `INSERT INTO sistema_config (clave, valor, actualizado_por, actualizado_en)
     VALUES ('adornos_temporada', $1::jsonb, $2, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor,
       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
    [JSON.stringify(activos), req.usuario.id],
  );
  sendSuccess(res, 200, { activos }, activos ? "Adornos de temporada encendidos" : "Adornos de temporada apagados");
});

module.exports = { getInicio, getAdornos, putAdornos };
