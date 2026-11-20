const db = require("../config/database");
const RolModulo = require("./RolModulo");
const Firma = require("./Firma");
const Presupuesto = require("./CompraPresupuesto");
const tipoCambio = require("../services/tipoCambio.service");
const archivosCompras = require("../services/comprasArchivos.service");
const { AppError } = require("../utils/errorHandler");

/**
 * La orden de compra con sus cuatro firmas.
 *
 * Ver migrations/2026-11-13_compras_solicitudes_13_orden_compra.sql y
 * 2026-11-18_compras_solicitudes_15_sin_cotizacion.sql. En corto:
 *
 *   EN_COMPRAS (Compras cotiza fuera del DBX) → el agente de Compras da de alta
 *   la orden con proveedor, monto sin IVA y el archivo de la cotización → firma
 *   el gerente (o suplente) → firma el jefe de Compras con el tipo → firma
 *   Finanzas con la cuenta y el CC → firma Dirección (si el monto llega al
 *   mínimo) → AUTORIZADA, y se descuenta del presupuesto del área. Cualquier
 *   rechazo la termina (NO_AUTORIZADA).
 *
 * Quién firma NO depende del rol ni del módulo: el gerente sale del área y los
 * demás de compras_firmantes. El módulo /compras/ordenes pone la entrada en el
 * menú; crear = dar de alta órdenes de sus tickets (agentes de Compras);
 * editar = ver todas y dar de alta cualquiera (el jefe de Compras).
 *
 * Quien pidió no ve proveedor, montos ni presupuesto (decisión del 18-nov):
 * en Solicitudes solo ve en qué firma va su orden.
 */

const MODULO = "/compras/ordenes";
const PASOS = ["GERENTE", "COMPRAS", "FINANZAS", "DIRECCION"];
const PAPELES = ["COMPRAS", "FINANZAS", "DIRECCION"];
const NOMBRE_PASO = { GERENTE: "el gerente", COMPRAS: "Compras", FINANZAS: "Finanzas", DIRECCION: "Dirección" };
// Cómo sale debajo de la firma
const COMO = {
  GERENTE: "Gerente del área",
  SUPLENTE: "Suplente del gerente",
  PROPIA: "Gerente del área (la pidió)",
  COMPRAS: "Compras",
  FINANZAS: "Finanzas",
  DIRECCION: "Dirección",
};

const F = (col) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;
const esAdmin = (u) => Boolean(u?.rol?.esAdmin || u?.rol?.es_admin);
const redondo = (n) => Math.round(n * 100) / 100;
const dinero = (n, moneda) =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

const texto = (v, max) => {
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (!s) return null;
  if (s.length > max) throw new AppError(`El texto es demasiado largo (máximo ${max})`, 400);
  return s;
};

async function verTodas(usuario) {
  if (esAdmin(usuario)) return true;
  const rolId = usuario.rol?.id || usuario.rolId;
  return rolId ? RolModulo.verificarPermiso(rolId, MODULO, "puede_editar") : false;
}

async function puedeCrear(usuario) {
  if (esAdmin(usuario)) return true;
  const rolId = usuario.rol?.id || usuario.rolId;
  return rolId ? RolModulo.verificarPermiso(rolId, MODULO, "puede_crear") : false;
}

const correoDe = (u) => (u?.email || "").trim().toLowerCase();

/** Quien ve el reporte de Formatos también abre el PDF de las órdenes que se volvieron formato. */
async function leeFormatos(usuario) {
  if (esAdmin(usuario)) return true;
  const rolId = usuario.rol?.id || usuario.rolId;
  return rolId ? RolModulo.verificarPermiso(rolId, "/compras/formatos", "puede_leer") : false;
}

async function evento(cliente, { solicitudId, tipo, usuarioId, como = null, detalle = null }) {
  await cliente.query(
    `INSERT INTO compras_solicitud_eventos (solicitud_id, tipo, usuario_id, como, detalle) VALUES ($1, $2, $3, $4, $5)`,
    [solicitudId, tipo, usuarioId, como, detalle],
  );
}

/** Los papeles del usuario: en qué listas de firmantes está. */
async function papelesDe(usuarioId, cliente = db) {
  const { rows } = await cliente.query("SELECT papel FROM compras_firmantes WHERE usuario_id = $1", [usuarioId]);
  return new Set(rows.map((r) => r.papel));
}

/**
 * ¿Puede el usuario firmar (o rechazar) el paso en que va la orden?
 * @returns {{ puede: boolean, como?: string, porque?: string }}
 */
function puedeFirmar(usuario, o, papeles) {
  if (o.estado !== "EN_FIRMAS") return { puede: false, porque: "La orden ya no está esperando firmas" };
  const propia = o.solicitante_id === usuario.id;
  // Firma un paso que viene después: que sepa que le falta esperar, no que "no es él"
  const despues = PASOS.slice(PASOS.indexOf(o.paso) + 1).some((p) => papeles.has(p));
  const esperar = { puede: false, mostrar: true, porque: `Todavía no te toca: falta que firme ${NOMBRE_PASO[o.paso]}` };
  if (o.paso === "GERENTE") {
    // Si la pidió el gerente, él es la autorización del área (como al aprobar
    // la solicitud). Si la pidió el suplente, tiene que firmar el gerente.
    if (o.gerente_id === usuario.id) return { puede: true, como: propia ? "PROPIA" : "GERENTE" };
    if (propia) return { puede: false, mostrar: true, porque: "La firma tu gerente: tú la pediste como suplente" };
    if (o.suplente_id === usuario.id) return { puede: true, como: "SUPLENTE" };
    return despues ? esperar : { puede: false, porque: "No eres el gerente ni el suplente de esta área" };
  }
  if (!papeles.has(o.paso)) {
    return despues ? esperar : { puede: false, porque: `No estás en la lista de quienes firman por ${NOMBRE_PASO[o.paso]}` };
  }
  if (propia) {
    return {
      puede: false,
      mostrar: true,
      porque: `No puedes firmar por ${NOMBRE_PASO[o.paso]} tu propia orden: tiene que firmarla otra persona de la lista`,
    };
  }
  return { puede: true, como: o.paso };
}

const SELECT_ORDEN = `
  SELECT o.id, o.solicitud_id, o.estado, o.paso, o.opcion_id, o.proveedor,
         o.monto::float AS monto, o.moneda, o.incluye_iva, o.comentario,
         o.clasif_tipo, o.cuenta, cc.nombre AS cuenta_nombre, o.centro_costos,
         o.requiere_direccion, o.monto_minimo_direccion::float AS monto_minimo_direccion,
         o.monto_mxn_sin_iva::float AS monto_mxn_sin_iva,
         ${F("o.enviada_en")} AS enviada_en, ${F("o.terminada_en")} AS terminada_en,
         o.rechazada_paso, o.motivo_rechazo, ur.nombre_completo AS rechazada_por_nombre,
         o.enviada_por, ue.nombre_completo AS enviada_por_nombre, o.envio_id,
         (SELECT count(*)::int FROM compras_ordenes oe WHERE oe.envio_id = o.envio_id) AS ordenes_del_envio,
         s.folio, s.asunto, s.detalle, s.osticket_numero, s.asignado_nombre, s.solicitante_id,
         s.compras_area_id, s.monto_presupuesto::float AS monto_presupuesto,
         ca.nombre AS area_nombre, ca.gerente_id, ca.suplente_id,
         us.nombre_completo AS solicitante_nombre
    FROM compras_ordenes o
    JOIN compras_solicitudes s ON s.id = o.solicitud_id
    JOIN compras_areas ca ON ca.id = s.compras_area_id
    JOIN usuarios us ON us.id = s.solicitante_id
    LEFT JOIN usuarios ur ON ur.id = o.rechazada_por
    LEFT JOIN usuarios ue ON ue.id = o.enviada_por
    LEFT JOIN compras_cuentas cc ON cc.codigo = o.cuenta`;

class CompraOrden {
  static MODULO = MODULO;
  static PASOS = PASOS;
  static COMO = COMO;
  static verTodas = verTodas;

  // =========================================================================
  // Quiénes firman
  // =========================================================================

  static async firmantes() {
    const [{ rows }, { rows: cfg }] = await Promise.all([
      db.query(
        `SELECT f.papel, u.id, u.nombre_completo, u.activo,
                EXISTS (SELECT 1 FROM usuarios_firmas uf WHERE uf.usuario_id = u.id AND uf.activa) AS tiene_firma
           FROM compras_firmantes f JOIN usuarios u ON u.id = f.usuario_id
          ORDER BY u.nombre_completo`,
      ),
      db.query("SELECT oc_monto_minimo_direccion::float AS minimo FROM compras_config WHERE id = 1"),
    ]);
    const lista = Object.fromEntries(PAPELES.map((p) => [p, rows.filter((r) => r.papel === p)]));
    return { ...lista, montoMinimo: cfg[0]?.minimo ?? 0 };
  }

  /** @param {Object} d { COMPRAS: [ids], FINANZAS: [ids], DIRECCION: [ids], montoMinimo } */
  static async guardarFirmantes(d, usuarioId) {
    const minimo = Number(String(d.montoMinimo ?? 0).replace(/[$,\s]/g, "") || 0);
    if (!Number.isFinite(minimo) || minimo < 0) throw new AppError("El monto mínimo no es válido", 400);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      for (const papel of PAPELES) {
        const ids = [...new Set((d[papel] || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
        if (ids.length > 10) throw new AppError("Máximo 10 personas por firma", 400);
        await cliente.query("DELETE FROM compras_firmantes WHERE papel = $1 AND NOT (usuario_id = ANY($2))", [papel, ids]);
        for (const id of ids) {
          await cliente.query(
            `INSERT INTO compras_firmantes (papel, usuario_id, agregado_por) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [papel, id, usuarioId],
          );
        }
      }
      await cliente.query("UPDATE compras_config SET oc_monto_minimo_direccion = $1 WHERE id = 1", [redondo(minimo)]);
      await cliente.query("COMMIT");
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23503") throw new AppError("Uno de los usuarios no existe", 400);
      throw e;
    } finally {
      cliente.release();
    }
    return this.firmantes();
  }

  // =========================================================================
  // Alta de la orden (Compras)
  // =========================================================================

  /** Qué puede el usuario en el alta: crear (sus tickets) y todas (el jefe). */
  static async alcanceAlta(usuario) {
    const [crear, todas] = await Promise.all([puedeCrear(usuario), verTodas(usuario)]);
    return { crear: crear || todas, todas, correo: correoDe(usuario) };
  }

  /**
   * Los tickets en Compras que esperan su orden: los asignados al agente en
   * osTicket (cruzando el correo) o todos para el jefe.
   */
  static async porDarDeAlta(usuario) {
    const a = await this.alcanceAlta(usuario);
    if (!a.crear) return { alcance: a, solicitudes: [] };
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.osticket_numero, s.osticket_estado, s.asignado_nombre, s.asignado_email,
              ${F("s.enviado_en")} AS enviado_en, ca.nombre AS area_nombre, us.nombre_completo AS solicitante_nombre,
              EXISTS (SELECT 1 FROM usuarios u WHERE lower(u.email) = s.asignado_email AND u.activo) AS asignado_en_dbx
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
        WHERE s.estado = 'EN_COMPRAS'
          AND ($1 OR (s.asignado_email IS NOT NULL AND s.asignado_email = $2))
        ORDER BY s.enviado_en ASC NULLS LAST
        LIMIT 300`,
      [a.todas, a.correo],
    );
    return { alcance: a, solicitudes: rows };
  }

  static async contarPorDarDeAlta(usuario) {
    return (await this.porDarDeAlta(usuario)).solicitudes.length;
  }

  /** Bloquea la solicitud y revisa que el usuario le pueda dar de alta su orden. */
  static async tomarParaAlta(cliente, solicitudId, usuario) {
    const a = await this.alcanceAlta(usuario);
    const { rows } = await cliente.query(
      `SELECT s.id, s.folio, s.osticket_numero, s.estado, s.asignado_email, s.solicitante_id, ca.gerente_id
         FROM compras_solicitudes s JOIN compras_areas ca ON ca.id = s.compras_area_id
        WHERE s.id = $1 FOR UPDATE OF s`,
      [solicitudId],
    );
    const s = rows[0];
    const leToca = s && (a.todas || (a.correo && s.asignado_email === a.correo));
    if (!s || !a.crear || !leToca) throw new AppError("Uno de los tickets no existe o no lo tienes asignado", 404);
    const quien = s.osticket_numero || s.folio;
    if (s.estado !== "EN_COMPRAS") {
      throw new AppError(
        ["EN_FIRMAS", "AUTORIZADA", "NO_AUTORIZADA"].includes(s.estado)
          ? `${quien} ya tiene orden de compra`
          : `${quien} todavía no está en Compras`,
        409,
      );
    }
    if (!s.gerente_id) {
      throw new AppError(`El área de ${quien} no tiene gerente: nadie podría firmar la orden. Avísale al administrador.`, 409);
    }
    return s;
  }

  /** La solicitud vista desde Compras para darle de alta su orden. */
  static async paraAlta(solicitudId, usuario) {
    const a = await this.alcanceAlta(usuario);
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.detalle, s.estado, s.osticket_numero, s.osticket_estado,
              s.asignado_nombre, s.asignado_email, ${F("s.creado_en")} AS creado_en, ${F("s.enviado_en")} AS enviado_en,
              s.compras_area_id, ca.nombre AS area_nombre, us.nombre_completo AS solicitante_nombre,
              ud.nombre_completo AS aprobo_nombre
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN usuarios ud ON ud.id = s.decidido_por
        WHERE s.id = $1`,
      [solicitudId],
    );
    const s = rows[0];
    const leToca = s && (a.todas || (a.correo && s.asignado_email === a.correo));
    if (!s || !a.crear || !leToca) throw new AppError("La solicitud no existe", 404);
    const [{ rows: archivos }, saldo] = await Promise.all([
      db.query(
        "SELECT id, nombre_original, tipo_mime, tamano_bytes FROM compras_solicitud_archivos WHERE solicitud_id = $1 ORDER BY id",
        [solicitudId],
      ),
      Presupuesto.saldoActual(s.compras_area_id),
    ]);
    return { ...s, archivos, presupuesto: saldo, max: { mb: archivosCompras.MAX_MB, archivos: archivosCompras.MAX_ARCHIVOS } };
  }

  /** Un adjunto de la solicitud, para quien da de alta la orden. */
  static async archivoDeSolicitud(solicitudId, archivoId, usuario) {
    await this.paraAlta(solicitudId, usuario);
    const { rows } = await db.query(
      "SELECT nombre_original, ruta, tipo_mime FROM compras_solicitud_archivos WHERE id = $1 AND solicitud_id = $2",
      [archivoId, solicitudId],
    );
    if (!rows[0]) throw new AppError("El archivo no existe", 404);
    return rows[0];
  }

  /**
   * Compras registra la cotización ganadora de uno o varios tickets a la vez
   * (20-nov-2026): la cotización y el comparativo se suben una vez y la tabla
   * de ganadores trae, por renglón, el ticket, la cantidad, la descripción, el
   * proveedor y el precio unitario sin IVA. Se crea una orden por ticket con sus
   * renglones (cada ticket puede tener varios proveedores) y todas pasan a la
   * firma del gerente de su área.
   *
   * @param {Object}   datos     { solicitudIds: [], moneda, comentario,
   *                               lineas: [{ solicitudId, cantidad, unidad, descripcion, proveedor, precio, motivo }] }
   * @param {Object[]} archivos  ya en disco (comprasArchivos.describir); si algo
   *                             falla aquí, quien llama los borra
   */
  static async darDeAltaLote(usuario, datos = {}, archivos = []) {
    const moneda = datos.moneda === "USD" ? "USD" : "MXN";
    const nota = texto(datos.comentario, 1000);
    const ids = [...new Set((datos.solicitudIds || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw new AppError("Escoge al menos un ticket", 400);
    if (ids.length > 30) throw new AppError("Máximo 30 tickets por registro", 400);
    if (!archivos.length) throw new AppError("Adjunta la cotización del proveedor (PDF, imagen o Excel)", 400);
    const lineas = Array.isArray(datos.lineas) ? datos.lineas : [];
    if (!lineas.length) throw new AppError("Pega la tabla de cotizaciones ganadoras", 400);
    if (lineas.length > 300) throw new AppError("Máximo 300 renglones por registro", 400);

    const limpias = lineas.map((l, i) => {
      const n = i + 1;
      const solicitudId = Number(l.solicitudId);
      if (!ids.includes(solicitudId)) throw new AppError(`El renglón ${n} no es de ninguno de los tickets escogidos`, 400);
      const cantidad = Number(String(l.cantidad ?? "").replace(/[,\s]/g, ""));
      if (!Number.isFinite(cantidad) || cantidad <= 0) throw new AppError(`El renglón ${n} no tiene cantidad`, 400);
      const descripcion = String(l.descripcion ?? "").trim();
      if (!descripcion) throw new AppError(`El renglón ${n} no tiene descripción`, 400);
      if (descripcion.length > 2000) throw new AppError(`La descripción del renglón ${n} es demasiado larga`, 400);
      const proveedor = String(l.proveedor ?? "").replace(/\s+/g, " ").trim();
      if (!proveedor) throw new AppError(`El renglón ${n} no tiene proveedor`, 400);
      if (proveedor.length > 200) throw new AppError(`El proveedor del renglón ${n} es demasiado largo`, 400);
      const precio = Number(String(l.precio ?? "").replace(/[$,\s]/g, ""));
      if (!Number.isFinite(precio) || precio < 0) throw new AppError(`El renglón ${n} no tiene precio unitario`, 400);
      const unidad = String(l.unidad ?? "").trim().slice(0, 20) || null;
      return {
        solicitudId,
        cantidad,
        unidad,
        descripcion,
        proveedor,
        precio,
        importe: redondo(cantidad * precio),
        motivo: texto(l.motivo, 1000),
      };
    });

    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows: env } = await cliente.query(
        "INSERT INTO compras_orden_envios (moneda, comentario, creado_por) VALUES ($1, $2, $3) RETURNING id",
        [moneda, nota, usuario.id],
      );
      const envioId = env[0].id;
      const ordenes = [];
      // En orden de id: dos registros a la vez no se bloquean entre sí
      for (const solicitudId of [...ids].sort((a, b) => a - b)) {
        const s = await this.tomarParaAlta(cliente, solicitudId, usuario);
        const suyas = limpias.filter((l) => l.solicitudId === solicitudId);
        if (!suyas.length) throw new AppError(`${s.osticket_numero || s.folio} no tiene renglones en la tabla`, 400);
        const monto = redondo(suyas.reduce((t, l) => t + l.importe, 0));
        if (!(monto > 0)) throw new AppError(`${s.osticket_numero || s.folio} suma $0`, 400);
        const proveedores = [...new Set(suyas.map((l) => l.proveedor))];
        const proveedor = (proveedores.length === 1 ? proveedores[0] : `Varios: ${proveedores.join(", ")}`).slice(0, 200);

        const { rows: o } = await cliente.query(
          `INSERT INTO compras_ordenes (solicitud_id, paso, proveedor, monto, moneda, incluye_iva, comentario, enviada_por, envio_id)
           VALUES ($1, 'GERENTE', $2, $3, $4, false, $5, $6, $7) RETURNING id`,
          [solicitudId, proveedor, monto, moneda, nota, usuario.id, envioId],
        );
        const ordenId = o[0].id;
        let k = 0;
        for (const l of suyas) {
          await cliente.query(
            `INSERT INTO compras_orden_lineas (orden_id, orden, cantidad, unidad, descripcion, proveedor, precio_unitario, importe, motivo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [ordenId, k++, l.cantidad, l.unidad, l.descripcion, l.proveedor, l.precio, l.importe, l.motivo],
          );
        }
        // La misma cotización le queda a cada orden (el archivo está una vez en disco)
        for (const a of archivos) {
          await cliente.query(
            `INSERT INTO compras_orden_archivos (orden_id, nombre_original, ruta, tipo_mime, tamano_bytes, subido_por)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [ordenId, a.nombreOriginal, a.ruta, a.tipoMime, a.tamanoBytes, usuario.id],
          );
        }
        await cliente.query("UPDATE compras_solicitudes SET estado = 'EN_FIRMAS' WHERE id = $1", [solicitudId]);
        await evento(cliente, {
          solicitudId,
          tipo: "OC_ALTA",
          usuarioId: usuario.id,
          detalle: `${proveedor} · ${dinero(monto, moneda)} sin IVA · ${suyas.length} ${suyas.length === 1 ? "renglón" : "renglones"}${
            ids.length > 1 ? ` (junto con ${ids.length - 1} ticket${ids.length === 2 ? "" : "s"} más)` : ""
          }${nota ? ` — ${nota}` : ""}`,
        });
        ordenes.push({ id: ordenId, solicitudId, folio: s.folio, ticket: s.osticket_numero, monto, proveedor });
      }
      await cliente.query("COMMIT");
      return { envioId, ordenes };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23505") throw new AppError("Uno de los tickets ya tiene orden de compra", 409);
      throw e;
    } finally {
      cliente.release();
    }
  }

  /** Los renglones de una orden: lo que se compra y a quién. */
  static async lineas(ordenId) {
    const { rows } = await db.query(
      `SELECT id, cantidad::float AS cantidad, unidad, descripcion, proveedor,
              precio_unitario::float AS precio_unitario, importe::float AS importe, motivo
         FROM compras_orden_lineas WHERE orden_id = $1 ORDER BY orden, id`,
      [ordenId],
    );
    return rows;
  }

  /** Los archivos de la cotización de una orden. */
  static async archivos(ordenId) {
    const { rows } = await db.query(
      `SELECT a.id, a.nombre_original, a.tipo_mime, a.tamano_bytes, ${F("a.subido_en")} AS subido_en
         FROM compras_orden_archivos a WHERE a.orden_id = $1 ORDER BY a.id`,
      [ordenId],
    );
    return rows;
  }

  /** Un archivo de la cotización, si el usuario puede ver la orden. */
  static async archivo(ordenId, archivoId, usuario) {
    await this.verificarAcceso(ordenId, usuario);
    const { rows } = await db.query(
      "SELECT nombre_original, ruta, tipo_mime FROM compras_orden_archivos WHERE id = $1 AND orden_id = $2",
      [archivoId, ordenId],
    );
    if (!rows[0]) throw new AppError("El archivo no existe", 404);
    return rows[0];
  }

  // =========================================================================
  // Bandejas
  // =========================================================================

  /**
   * @param {String} vista  por-firmar | firmadas (lo que firmé o rechacé) | todas (con editar)
   */
  static async listar(usuario, vista = "por-firmar") {
    const papeles = [...(await papelesDe(usuario.id))];
    let where;
    let orden = "o.enviada_en DESC";
    const params = [usuario.id];
    if (vista === "por-firmar") {
      params.push(papeles);
      where = `o.estado = 'EN_FIRMAS'
               AND ((o.paso = 'GERENTE' AND (ca.gerente_id = $1 OR (ca.suplente_id = $1 AND s.solicitante_id <> $1)))
                    OR (o.paso <> 'GERENTE' AND o.paso = ANY($2) AND s.solicitante_id <> $1))`;
      orden = "o.enviada_en ASC";
    } else if (vista === "firmadas") {
      where = `(EXISTS (SELECT 1 FROM compras_orden_firmas f WHERE f.orden_id = o.id AND f.usuario_id = $1)
                OR o.rechazada_por = $1)`;
    } else if (vista === "todas") {
      if (!(await verTodas(usuario))) throw new AppError("No tienes permiso para ver todas las órdenes", 403);
      where = "true";
      // Aquí no se filtra por usuario: sin parámetros (Postgres no acepta uno de más)
      params.length = 0;
    } else {
      throw new AppError(`Vista no válida: "${vista}"`, 400);
    }
    const { rows } = await db.query(
      `${SELECT_ORDEN}
        WHERE ${where}
        ORDER BY ${orden}
        LIMIT 300`,
      params,
    );
    return rows;
  }

  /** Cuántas esperan la firma del usuario (Inicio y el contador de la pestaña). */
  static async contarPorFirmar(usuario) {
    const papeles = [...(await papelesDe(usuario.id))];
    const { rows } = await db.query(
      `SELECT count(*)::int AS n
         FROM compras_ordenes o
         JOIN compras_solicitudes s ON s.id = o.solicitud_id
         JOIN compras_areas ca ON ca.id = s.compras_area_id
        WHERE o.estado = 'EN_FIRMAS'
          AND ((o.paso = 'GERENTE' AND (ca.gerente_id = $1 OR (ca.suplente_id = $1 AND s.solicitante_id <> $1)))
               OR (o.paso <> 'GERENTE' AND o.paso = ANY($2) AND s.solicitante_id <> $1))`,
      [usuario.id, papeles],
    );
    return rows[0].n;
  }

  // =========================================================================
  // Detalle
  // =========================================================================

  /** Las firmas de una orden, con la imagen con la que se firmó. */
  static async firmas(ordenId) {
    const { rows } = await db.query(
      `SELECT f.paso, f.como, f.comentario, ${F("f.firmado_en")} AS firmado_en,
              u.nombre_completo AS nombre, uf.imagen
         FROM compras_orden_firmas f
         JOIN usuarios u ON u.id = f.usuario_id
         JOIN usuarios_firmas uf ON uf.id = f.firma_id
        WHERE f.orden_id = $1`,
      [ordenId],
    );
    return rows.map((r) => ({
      paso: r.paso,
      como: r.como,
      comoTexto: COMO[r.como] || r.como,
      comentario: r.comentario,
      firmado_en: r.firmado_en,
      nombre: r.nombre,
      imagen: r.imagen ? `data:image/png;base64,${Buffer.from(r.imagen).toString("base64")}` : null,
    }));
  }

  /**
   * La orden de una solicitud, para la pantalla de Solicitudes. Con montos para
   * el gerente; para quien pidió, solo en qué firma va (sin proveedor, montos,
   * tipo ni cuenta).
   */
  static async deSolicitud(solicitudId, { conMontos = false } = {}) {
    const { rows } = await db.query(`${SELECT_ORDEN} WHERE o.solicitud_id = $1`, [solicitudId]);
    if (!rows[0]) return null;
    const o = rows[0];
    const firmas = await this.firmas(o.id);
    if (conMontos) return { ...o, firmas, lineas: await this.lineas(o.id), verPdf: true };
    return {
      id: o.id,
      estado: o.estado,
      paso: o.paso,
      enviada_en: o.enviada_en,
      terminada_en: o.terminada_en,
      enviada_por_nombre: o.enviada_por_nombre,
      requiere_direccion: o.requiere_direccion,
      rechazada_paso: o.rechazada_paso,
      rechazada_por_nombre: o.rechazada_por_nombre,
      motivo_rechazo: o.motivo_rechazo,
      firmas,
      verPdf: false,
    };
  }

  /**
   * Una orden con todo lo que hace falta para firmarla: la cotización, el
   * presupuesto del área, las firmas y, si le toca al usuario, las listas de
   * tipos o cuentas.
   */
  /**
   * ¿Puede el usuario ver la orden (con proveedor y monto)? El gerente y su
   * suplente, quien firma, quien la dio de alta, quien ve todas y, ya
   * autorizada, quien lee Formatos. Quien solo la pidió, no.
   */
  static async verificarAcceso(ordenId, usuario, o = null) {
    if (!o) {
      const { rows } = await db.query(`${SELECT_ORDEN} WHERE o.id = $1`, [ordenId]);
      o = rows[0];
    }
    if (!o) throw new AppError("La orden no existe", 404);
    const papeles = await papelesDe(usuario.id);
    const { rows: firmo } = await db.query(
      "SELECT 1 FROM compras_orden_firmas WHERE orden_id = $1 AND usuario_id = $2",
      [o.id, usuario.id],
    );
    const puedeVer =
      [o.gerente_id, o.suplente_id, o.enviada_por].includes(usuario.id) ||
      papeles.size > 0 ||
      firmo.length > 0 ||
      (await verTodas(usuario)) ||
      (o.estado === "AUTORIZADA" && (await leeFormatos(usuario)));
    if (!puedeVer) throw new AppError("La orden no existe", 404);
    return { o, papeles };
  }

  static async obtener(ordenId, usuario) {
    const { rows } = await db.query(`${SELECT_ORDEN} WHERE o.id = $1`, [ordenId]);
    const { o, papeles } = await this.verificarAcceso(ordenId, usuario, rows[0]);

    const turno = puedeFirmar(usuario, o, papeles);

    const [firmas, saldo, catalogos, iva, tc, archivos, lineas] = await Promise.all([
      this.firmas(ordenId),
      Presupuesto.saldoActual(o.compras_area_id),
      turno.puede && ["COMPRAS", "FINANZAS"].includes(o.paso) ? this.catalogos() : null,
      Presupuesto.ivaTasa(),
      tipoCambio.ultimo(),
      this.archivos(ordenId),
      this.lineas(ordenId),
    ]);

    // Cuánto descontaría hoy (mientras no se autoriza) o cuánto descontó
    let presupuesto = null;
    if (o.estado === "EN_FIRMAS") {
      const { monto } = Presupuesto.montoParaPresupuesto(
        { total: o.monto, moneda: o.moneda, incluyeIva: o.incluye_iva },
        { tc: tc?.valor, iva },
      );
      presupuesto = {
        saldo,
        monto,
        quedaMes: monto == null ? null : redondo(saldo.disponibleMes - monto),
        rebasa: monto != null && saldo.configurado && saldo.disponibleMes - monto < 0,
        tipoCambio: o.moneda === "USD" && tc ? { valor: tc.valor, fecha: tc.fecha } : null,
      };
    } else if (o.estado === "AUTORIZADA") {
      presupuesto = { saldo, monto: o.monto_presupuesto, descontado: true };
    }

    const { rows: cfg } = await db.query(
      `SELECT oc_monto_minimo_direccion::float AS minimo, ${F("now()")} AS ahora FROM compras_config WHERE id = 1`,
    );
    return {
      generado_en: cfg[0]?.ahora,
      ...o,
      firmas,
      archivos,
      lineas,
      presupuesto,
      catalogos,
      montoMinimoDireccion: o.monto_minimo_direccion ?? cfg[0]?.minimo ?? 0,
      permisos: {
        firmar: turno.puede,
        como: turno.como || null,
        comoTexto: turno.como ? COMO[turno.como] : null,
        // Por qué no puede, solo si firma más adelante o es su propia orden (a quien solo mira no se le dice nada)
        porque: !turno.puede && turno.mostrar ? turno.porque : null,
      },
    };
  }

  /** Tipos y cuentas activos, para quien firma por Compras o Finanzas. */
  static async catalogos() {
    const [t, c] = await Promise.all([
      db.query("SELECT id, nombre, activo FROM compras_tipos WHERE activo ORDER BY lower(nombre)"),
      db.query("SELECT codigo, nombre, activo FROM compras_cuentas WHERE activo ORDER BY codigo"),
    ]);
    return { tipos: t.rows, cuentas: c.rows };
  }

  // =========================================================================
  // Firmar y rechazar
  // =========================================================================

  /** Bloquea la orden y revisa que le toque al usuario. */
  static async tomar(cliente, ordenId, usuario) {
    const { rows } = await cliente.query(
      `SELECT o.id, o.solicitud_id, o.estado, o.paso, o.proveedor, o.monto::float AS monto, o.moneda, o.incluye_iva,
              s.folio, s.solicitante_id, s.compras_area_id, ca.gerente_id, ca.suplente_id
         FROM compras_ordenes o
         JOIN compras_solicitudes s ON s.id = o.solicitud_id
         JOIN compras_areas ca ON ca.id = s.compras_area_id
        WHERE o.id = $1
          FOR UPDATE OF o, s`,
      [ordenId],
    );
    const o = rows[0];
    if (!o) throw new AppError("La orden no existe", 404);
    if (o.estado !== "EN_FIRMAS") {
      throw new AppError(`${o.folio}: ${o.estado === "AUTORIZADA" ? "la orden ya quedó autorizada" : "la orden ya fue rechazada"}`, 409);
    }
    const turno = puedeFirmar(usuario, o, await papelesDe(usuario.id, cliente));
    if (!turno.puede) throw new AppError(`${o.folio}: ${turno.porque}`, 403);
    return { o, como: turno.como };
  }

  /**
   * Firma el paso en que va la orden.
   * @param {Object} d { pin, tipo (Compras), cuenta y centroCostos (Finanzas), comentario }
   */
  static async firmar(ordenId, usuario, d = {}) {
    const r = await this.firmarLote([ordenId], usuario, d);
    return r.firmadas[0];
  }

  /**
   * Firma varias órdenes juntas con un solo PIN (20-nov-2026). Tienen que ir en
   * el mismo paso; Compras les pone a todas el mismo tipo y Finanzas la misma
   * cuenta y centro de costos. Todo o nada: si una ya no se puede firmar, no se
   * firma ninguna.
   *
   * @param {Object} d { pin, tipo (Compras), cuenta y centroCostos (Finanzas), comentario }
   */
  static async firmarLote(ordenIds, usuario, d = {}) {
    const ids = [...new Set((ordenIds || []).map(Number))].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
    if (!ids.length) throw new AppError("Escoge al menos una orden", 400);
    if (ids.length > 50) throw new AppError("Máximo 50 órdenes a la vez", 400);
    const nota = texto(d.comentario, 1000);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const tomadas = [];
      for (const id of ids) tomadas.push(await this.tomar(cliente, id, usuario));
      const paso = tomadas[0].o.paso;
      if (tomadas.some((t) => t.o.paso !== paso)) {
        throw new AppError("Las órdenes que firmas juntas tienen que ir en el mismo paso", 400);
      }

      // Lo que pone cada quien, antes de pedir el PIN: si falta algo no gasta intento
      const comunes = {};
      if (paso === "COMPRAS") {
        const tipo = String(d.tipo ?? "").replace(/\s+/g, " ").trim();
        if (!tipo) throw new AppError("Escoge el tipo de compra antes de firmar", 400);
        const { rows } = await cliente.query("SELECT nombre FROM compras_tipos WHERE activo AND lower(nombre) = lower($1)", [tipo]);
        if (!rows[0]) throw new AppError(`"${tipo}" no está en la lista de tipos`, 400);
        comunes.clasif_tipo = rows[0].nombre;
      }
      if (paso === "FINANZAS") {
        const cuenta = String(d.cuenta ?? "").replace(/\D/g, "");
        if (!cuenta) throw new AppError("Escoge la cuenta antes de firmar", 400);
        const { rows } = await cliente.query("SELECT codigo FROM compras_cuentas WHERE activo AND codigo = $1", [cuenta]);
        if (!rows[0]) throw new AppError(`La cuenta ${cuenta} no está en la lista`, 400);
        comunes.cuenta = cuenta;
        comunes.centro_costos = texto(d.centroCostos, 60);
      }

      if (!d.pin) throw new AppError("Escribe tu PIN de firma", 400);
      const firma = await Firma.verificar(usuario.id, d.pin, cliente);

      // Para Finanzas: el mínimo de Dirección y el tipo de cambio, una vez
      let minimo = 0;
      let iva = 0.16;
      let tc = null;
      if (paso === "FINANZAS") {
        const [{ rows: cfg }, i, t] = await Promise.all([
          cliente.query("SELECT oc_monto_minimo_direccion::float AS minimo FROM compras_config WHERE id = 1"),
          Presupuesto.ivaTasa(cliente),
          tipoCambio.ultimo(),
        ]);
        minimo = cfg[0]?.minimo ?? 0;
        iva = i;
        tc = t;
      }

      const firmadas = [];
      for (const { o, como } of tomadas) {
        await cliente.query(
          `INSERT INTO compras_orden_firmas (orden_id, paso, usuario_id, firma_id, como, comentario)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [o.id, paso, usuario.id, firma.id, como, nota],
        );

        const cambios = { ...comunes };
        let siguiente = PASOS[PASOS.indexOf(paso) + 1] || null;
        if (paso === "FINANZAS") {
          const { monto } = Presupuesto.montoParaPresupuesto(
            { total: o.monto, moneda: o.moneda, incluyeIva: o.incluye_iva },
            { tc: tc?.valor, iva },
          );
          // Sin tipo de cambio no se sabe si llega: mejor que firme Dirección
          const requiere = minimo <= 0 || monto == null || monto >= minimo;
          cambios.requiere_direccion = requiere;
          cambios.monto_minimo_direccion = minimo;
          cambios.monto_mxn_sin_iva = monto;
          if (!requiere) siguiente = null;
        }

        const sets = Object.keys(cambios).map((k, i) => `${k} = $${i + 2}`);
        if (sets.length) {
          await cliente.query(`UPDATE compras_ordenes SET ${sets.join(", ")} WHERE id = $1`, [o.id, ...Object.values(cambios)]);
        }

        const detalle = [
          cambios.clasif_tipo && `Tipo: ${cambios.clasif_tipo}`,
          cambios.cuenta && `Cuenta: ${cambios.cuenta}${cambios.centro_costos ? ` · CC: ${cambios.centro_costos}` : ""}`,
          paso === "FINANZAS" && !cambios.requiere_direccion && `Abajo del mínimo para Dirección (${dinero(cambios.monto_minimo_direccion, "MXN")})`,
          ids.length > 1 && `Firmada junto con ${ids.length - 1} ${ids.length === 2 ? "orden" : "órdenes"} más`,
          nota,
        ].filter(Boolean).join(" — ");
        await evento(cliente, { solicitudId: o.solicitud_id, tipo: `OC_FIRMA_${paso}`, usuarioId: usuario.id, como, detalle: detalle || null });

        let autorizada = false;
        if (siguiente) {
          await cliente.query("UPDATE compras_ordenes SET paso = $2 WHERE id = $1", [o.id, siguiente]);
        } else {
          await this.autorizar(cliente, o, usuario);
          autorizada = true;
        }
        firmadas.push({ id: o.id, solicitudId: o.solicitud_id, folio: o.folio, paso, siguiente, autorizada });
      }

      await cliente.query("COMMIT");
      return { paso, firmadas };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23505") throw new AppError("Una de las órdenes ya estaba firmada en ese paso", 409);
      throw e;
    } finally {
      cliente.release();
    }
  }

  /**
   * La orden queda autorizada: se descuenta del presupuesto del área, sin IVA
   * y en pesos, con el FIX más reciente, en el mes de hoy.
   */
  static async autorizar(cliente, o, usuario) {
    const [iva, tc, hoy] = await Promise.all([Presupuesto.ivaTasa(cliente), tipoCambio.ultimo(), Presupuesto.hoyMexico(cliente)]);
    const { monto, tipoCambio: tcUsado } = Presupuesto.montoParaPresupuesto(
      { total: o.monto, moneda: o.moneda, incluyeIva: o.incluye_iva },
      { tc: tc?.valor, iva },
    );
    await cliente.query(
      "UPDATE compras_ordenes SET estado = 'AUTORIZADA', paso = NULL, terminada_en = now() WHERE id = $1",
      [o.id],
    );
    await cliente.query(
      `UPDATE compras_solicitudes
          SET estado = 'AUTORIZADA', monto_presupuesto = $2, tipo_cambio_presupuesto = $3,
              presupuesto_anio = $4, presupuesto_mes = $5
        WHERE id = $1`,
      [o.solicitud_id, monto, tcUsado, hoy.anio, hoy.mes],
    );
    await evento(cliente, {
      solicitudId: o.solicitud_id,
      tipo: "OC_AUTORIZADA",
      usuarioId: usuario.id,
      detalle:
        monto == null
          ? "Sin tipo de cambio: no se descontó del presupuesto"
          : `Se descontaron ${dinero(monto, "MXN")} del presupuesto (sin IVA)`,
    });
    // Queda registrada en Formatos (y así en el Tablero), como el formato en papel
    await cliente.query("SELECT compras_formato_de_orden($1)", [o.id]);
  }

  /** Cualquier rechazo termina la orden y la solicitud. */
  static async rechazar(ordenId, usuario, { motivo }) {
    const razon = texto(motivo, 1000);
    if (!razon) throw new AppError("Escribe el motivo del rechazo", 400);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { o, como } = await this.tomar(cliente, ordenId, usuario);
      await cliente.query(
        `UPDATE compras_ordenes
            SET estado = 'RECHAZADA', rechazada_paso = paso, paso = NULL, terminada_en = now(),
                rechazada_por = $2, motivo_rechazo = $3
          WHERE id = $1`,
        [ordenId, usuario.id, razon],
      );
      await cliente.query("UPDATE compras_solicitudes SET estado = 'NO_AUTORIZADA' WHERE id = $1", [o.solicitud_id]);
      await evento(cliente, { solicitudId: o.solicitud_id, tipo: "OC_RECHAZADA", usuarioId: usuario.id, como, detalle: razon });
      await cliente.query("COMMIT");
      return { id: ordenId, solicitudId: o.solicitud_id, folio: o.folio, paso: o.paso };
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }
}

module.exports = CompraOrden;
