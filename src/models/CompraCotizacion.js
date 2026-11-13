const fs = require("fs");
const db = require("../config/database");
const RolModulo = require("./RolModulo");
const Presupuesto = require("./CompraPresupuesto");
const { rutaAbsoluta } = require("../services/comprasArchivos.service");
const { AppError } = require("../utils/errorHandler");

/**
 * Cotizaciones de Compras: las opciones de proveedores que el agente manda al
 * solicitante, la que éste sugiere y la que Compras decide.
 *
 * Flujo (13-nov-2026): COTIZADA → el solicitante SUGIERE una opción con su
 * opinión técnica (SUGERIDA) o pide otras → Compras DECIDE (DECIDIDA). La
 * sugerencia no obliga, pero si Compras escoge otra tiene que decir por qué.
 * Decidir no descuenta presupuesto: eso pasa al autorizarse la orden de compra.
 * ELEGIDA queda solo para las solicitudes de antes, que eligió el solicitante.
 *
 * Ver migrations/2026-11-02_compras_solicitudes_04_cotizaciones.sql.
 *
 * Quién ve una solicitud en Compras:
 *   - el agente que tiene asignado el ticket en osTicket (por correo), o
 *   - quien tenga "editar" en el módulo de Cotizaciones (el jefe de Compras),
 *     o el administrador.
 *
 * El comparativo es una tabla: partidas (lo que se pide) por opciones (cada
 * proveedor). El total de un proveedor es la suma de cantidad × precio de las
 * partidas que cotizó; una partida sin precio es que ese proveedor no la tiene.
 */

const MODULO = "/compras/cotizaciones";
const MAX_PARTIDAS = 50;
const MAX_OPCIONES = 8;

const F = (col) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;

const VISTAS = {
  "por-cotizar": { estados: ["EN_COMPRAS"], orden: "s.enviado_en ASC" },
  esperando: { estados: ["COTIZADA"], orden: "c.enviada_en ASC" },
  "por-decidir": { estados: ["SUGERIDA"], orden: "s.sugerido_en ASC" },
  decididas: { estados: ["DECIDIDA", "ELEGIDA"], orden: "s.elegido_en DESC" },
};
// Los correos viejos traen ?vista=elegidas
VISTAS.elegidas = VISTAS.decididas;

// Mientras se puede sugerir o decidir
const POR_DECIDIR = ["COTIZADA", "SUGERIDA"];

const esAdmin = (u) => Boolean(u?.rol?.esAdmin || u?.rol?.es_admin);
const correoDe = (u) => (u?.email || "").trim().toLowerCase();

/** ¿Puede el usuario hacer `tipo` en el módulo? El admin, siempre. */
async function permiso(usuario, tipo) {
  if (esAdmin(usuario)) return true;
  const rolId = usuario?.rol?.id || usuario?.rolId;
  return rolId ? RolModulo.verificarPermiso(rolId, MODULO, tipo) : false;
}

const redondo = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const numero = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
const texto = (v, max) => {
  const t = String(v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

async function evento(cliente, { solicitudId, tipo, usuarioId, detalle = null }) {
  await cliente.query(
    `INSERT INTO compras_solicitud_eventos (solicitud_id, tipo, usuario_id, detalle) VALUES ($1, $2, $3, $4)`,
    [solicitudId, tipo, usuarioId, detalle],
  );
}

/** "$3,000.00 MXN" */
const dinero = (n, moneda) =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda}`;

class CompraCotizacion {
  static MODULO = MODULO;

  /** Lo que el usuario puede hacer en la bandeja. */
  static async alcance(usuario) {
    const [todas, cotizar] = await Promise.all([permiso(usuario, "puede_editar"), permiso(usuario, "puede_crear")]);
    return { todas, cotizar, correo: correoDe(usuario) };
  }

  /** ¿Le toca esta solicitud al usuario? */
  static leToca(sol, alcance) {
    return alcance.todas || (Boolean(alcance.correo) && sol.asignado_email === alcance.correo);
  }

  /**
   * La bandeja de Compras.
   * @param {String} vista  por-cotizar | esperando | elegidas
   */
  static async listar(usuario, vista = "por-cotizar") {
    const v = VISTAS[vista];
    if (!v) throw new AppError(`Vista no válida: "${vista}"`, 400);
    const alcance = await this.alcance(usuario);
    const valores = [v.estados];
    let filtro = "";
    if (!alcance.todas) {
      valores.push(alcance.correo || "-");
      filtro = ` AND s.asignado_email = $${valores.length}`;
    }
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.estado, s.osticket_numero, s.osticket_estado,
              s.asignado_nombre, s.asignado_email,
              EXISTS (SELECT 1 FROM usuarios u WHERE lower(u.email) = s.asignado_email AND u.activo) AS asignado_en_dbx,
              ${F("s.enviado_en")} AS enviado_en,
              ${F("c.enviada_en")} AS cotizada_en,
              ${F("s.elegido_en")} AS elegido_en,
              s.monto_elegido::float AS monto_elegido, s.moneda_elegida,
              o.proveedor AS proveedor_elegido,
              os.proveedor AS proveedor_sugerido, ${F("s.sugerido_en")} AS sugerido_en,
              ca.nombre AS area_nombre, us.nombre_completo AS solicitante_nombre,
              EXISTS (SELECT 1 FROM compras_cotizaciones b WHERE b.solicitud_id = s.id AND b.estado = 'BORRADOR') AS con_borrador,
              (SELECT count(*)::int FROM compras_cotizaciones d WHERE d.solicitud_id = s.id AND d.estado = 'DESCARTADA') AS descartadas
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN compras_cotizaciones c ON c.solicitud_id = s.id AND c.estado = 'ENVIADA'
         LEFT JOIN compras_cotizacion_opciones o ON o.id = s.opcion_elegida_id
         LEFT JOIN compras_cotizacion_opciones os ON os.id = s.opcion_sugerida_id
        WHERE s.estado = ANY($1)${filtro}
        ORDER BY ${v.orden}
        LIMIT 300`,
      valores,
    );
    return { filas: rows, alcance: { todas: alcance.todas, cotizar: alcance.cotizar } };
  }

  /** Cuántas hay en cada pestaña, para los contadores. */
  static async contar(usuario) {
    const alcance = await this.alcance(usuario);
    const valores = [];
    let filtro = "";
    if (!alcance.todas) {
      valores.push(alcance.correo || "-");
      filtro = " AND asignado_email = $1";
    }
    const { rows } = await db.query(
      `SELECT count(*) FILTER (WHERE estado = 'EN_COMPRAS')::int AS "por-cotizar",
              count(*) FILTER (WHERE estado = 'COTIZADA')::int AS esperando,
              count(*) FILTER (WHERE estado = 'SUGERIDA')::int AS "por-decidir"
         FROM compras_solicitudes WHERE estado IN ('EN_COMPRAS', 'COTIZADA', 'SUGERIDA')${filtro}`,
      valores,
    );
    return rows[0];
  }

  /**
   * El comparativo completo de una cotización: partidas, opciones con sus
   * precios por partida y su total.
   */
  static async completa(cotizacionId) {
    const { rows: cab } = await db.query(
      `SELECT c.id, c.solicitud_id, c.estado, c.mensaje, c.incluye_iva, c.motivo_descarte,
              ${F("c.enviada_en")} AS enviada_en, ${F("c.actualizada_en")} AS actualizada_en,
              ${F("c.descartada_en")} AS descartada_en,
              u.nombre_completo AS enviada_por_nombre, u.email AS enviada_por_email
         FROM compras_cotizaciones c
         LEFT JOIN usuarios u ON u.id = c.enviada_por
        WHERE c.id = $1`,
      [cotizacionId],
    );
    if (!cab[0]) return null;
    const [partidas, opciones, precios, archivos] = await Promise.all([
      db.query(
        `SELECT id, descripcion, cantidad::float AS cantidad, unidad
           FROM compras_cotizacion_partidas WHERE cotizacion_id = $1 ORDER BY orden, id`,
        [cotizacionId],
      ),
      db.query(
        `SELECT id, proveedor, moneda, tiempo_entrega, credito, observaciones, archivo_id
           FROM compras_cotizacion_opciones WHERE cotizacion_id = $1 ORDER BY orden, id`,
        [cotizacionId],
      ),
      db.query(
        `SELECT p.opcion_id, p.partida_id, p.precio_unitario::float AS precio, p.descripcion, p.imagen_id
           FROM compras_cotizacion_precios p
           JOIN compras_cotizacion_opciones o ON o.id = p.opcion_id
          WHERE o.cotizacion_id = $1`,
        [cotizacionId],
      ),
      db.query(
        `SELECT id, nombre_original, tipo_mime, tamano_bytes
           FROM compras_cotizacion_archivos WHERE cotizacion_id = $1 ORDER BY id`,
        [cotizacionId],
      ),
    ]);
    const archivoPorId = new Map(archivos.rows.map((a) => [a.id, a]));
    const cantidad = new Map(partidas.rows.map((p) => [p.id, p.cantidad]));

    const ops = opciones.rows.map((o) => {
      const suyos = precios.rows.filter((p) => p.opcion_id === o.id);
      const porPartida = {};
      let total = 0;
      let cotizadas = 0;
      for (const p of suyos) {
        porPartida[p.partida_id] = {
          precio: p.precio,
          descripcion: p.descripcion,
          imagen: p.imagen_id ? archivoPorId.get(p.imagen_id) || null : null,
          importe: p.precio == null || cantidad.get(p.partida_id) == null ? null : redondo(p.precio * cantidad.get(p.partida_id)),
        };
        if (p.precio != null && cantidad.get(p.partida_id) != null) {
          total += p.precio * cantidad.get(p.partida_id);
          cotizadas++;
        }
      }
      return {
        ...o,
        archivo: o.archivo_id ? archivoPorId.get(o.archivo_id) || null : null,
        precios: porPartida,
        total: redondo(total),
        cotizadas,
        completa: cotizadas === partidas.rows.length,
      };
    });

    // La más barata, solo si todas están en la misma moneda y cotizaron todo
    const comparables = ops.filter((o) => o.completa && o.cotizadas > 0);
    const monedas = new Set(comparables.map((o) => o.moneda));
    const masBarata =
      comparables.length > 1 && monedas.size === 1
        ? comparables.reduce((a, b) => (b.total < a.total ? b : a)).id
        : null;

    return { ...cab[0], partidas: partidas.rows, opciones: ops, archivos: archivos.rows, masBarata };
  }

  /**
   * Lo que ve el solicitante: la enviada vigente, cuántas se descartaron y,
   * mientras no se decide, cuánto descontaría cada opción del presupuesto de su
   * área (solo para informar: se descuenta al autorizarse la orden de compra).
   */
  static async paraSolicitante(solicitudId) {
    const { rows } = await db.query(
      `SELECT c.id, s.compras_area_id, s.estado
         FROM compras_solicitudes s
         LEFT JOIN compras_cotizaciones c ON c.solicitud_id = s.id AND c.estado = 'ENVIADA'
        WHERE s.id = $1`,
      [solicitudId],
    );
    const { rows: d } = await db.query(
      `SELECT count(*)::int AS n FROM compras_cotizaciones WHERE solicitud_id = $1 AND estado = 'DESCARTADA'`,
      [solicitudId],
    );
    const cotizacion = rows[0]?.id ? await this.completa(rows[0].id) : null;
    const impacto =
      cotizacion && POR_DECIDIR.includes(rows[0].estado)
        ? await Presupuesto.impacto(cotizacion, rows[0].compras_area_id)
        : null;
    return { cotizacion, descartadas: d[0].n, impacto };
  }

  /** La solicitud vista desde Compras, si le toca al usuario. */
  static async obtener(solicitudId, usuario) {
    const alcance = await this.alcance(usuario);
    const { rows } = await db.query(
      `SELECT s.id, s.folio, s.asunto, s.detalle, s.estado, s.osticket_numero, s.osticket_estado,
              s.asignado_nombre, s.asignado_email, s.opcion_elegida_id, s.compras_area_id,
              s.opcion_sugerida_id, s.sugerencia, ${F("s.sugerido_en")} AS sugerido_en, s.decision_nota,
              ue.nombre_completo AS elegido_por_nombre,
              s.monto_presupuesto::float AS monto_presupuesto,
              s.monto_elegido::float AS monto_elegido, s.moneda_elegida,
              ${F("s.creado_en")} AS creado_en, ${F("s.enviado_en")} AS enviado_en, ${F("s.elegido_en")} AS elegido_en,
              ca.nombre AS area_nombre, us.nombre_completo AS solicitante_nombre, us.email AS solicitante_email,
              ud.nombre_completo AS decidido_por_nombre
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
         JOIN usuarios us ON us.id = s.solicitante_id
         LEFT JOIN usuarios ud ON ud.id = s.decidido_por
         LEFT JOIN usuarios ue ON ue.id = s.elegido_por
        WHERE s.id = $1 AND s.estado IN ('EN_COMPRAS', 'COTIZADA', 'SUGERIDA', 'DECIDIDA', 'ELEGIDA')`,
      [solicitudId],
    );
    const sol = rows[0];
    if (!sol || !this.leToca(sol, alcance)) throw new AppError("La solicitud no existe", 404);

    const [archivos, eventos, cots] = await Promise.all([
      db.query(
        `SELECT id, nombre_original, tipo_mime, tamano_bytes FROM compras_solicitud_archivos
          WHERE solicitud_id = $1 ORDER BY id`,
        [solicitudId],
      ),
      db.query(
        `SELECT e.tipo, e.como, e.detalle, ${F("e.creado_en")} AS creado_en, u.nombre_completo AS usuario_nombre
           FROM compras_solicitud_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.solicitud_id = $1 ORDER BY e.creado_en, e.id`,
        [solicitudId],
      ),
      db.query(`SELECT id, estado FROM compras_cotizaciones WHERE solicitud_id = $1 ORDER BY id DESC`, [solicitudId]),
    ]);
    const deEstado = (e) => cots.rows.filter((c) => c.estado === e);
    const borrador = deEstado("BORRADOR")[0];
    const enviada = deEstado("ENVIADA")[0];
    const enviadaCompleta = enviada ? await this.completa(enviada.id) : null;
    const puedeDecidir = alcance.cotizar && POR_DECIDIR.includes(sol.estado);

    return {
      ...sol,
      archivos: archivos.rows,
      eventos: eventos.rows,
      borrador: borrador ? await this.completa(borrador.id) : null,
      enviada: enviadaCompleta,
      descartadas: await Promise.all(deEstado("DESCARTADA").map((c) => this.completa(c.id))),
      // Para que Compras vea cuánto le queda al área al cotizar
      presupuesto: await Presupuesto.saldoActual(sol.compras_area_id),
      // Al decidir, cuánto descontaría cada opción cuando se autorice la orden
      impacto: puedeDecidir && enviadaCompleta ? await Presupuesto.impacto(enviadaCompleta, sol.compras_area_id) : null,
      permisos: { cotizar: alcance.cotizar && sol.estado === "EN_COMPRAS", decidir: puedeDecidir },
    };
  }

  /**
   * Bloquea la solicitud y revisa que el usuario la pueda cotizar ahora.
   * Regresa el renglón y el borrador (lo crea si no hay).
   */
  static async tomarParaCotizar(cliente, solicitudId, usuario) {
    const alcance = await this.alcance(usuario);
    const { rows } = await cliente.query(
      `SELECT id, folio, estado, asignado_email FROM compras_solicitudes WHERE id = $1 FOR UPDATE`,
      [solicitudId],
    );
    const sol = rows[0];
    if (!sol || !this.leToca(sol, alcance)) throw new AppError("La solicitud no existe", 404);
    if (!alcance.cotizar) throw new AppError("No tienes permiso para cotizar", 403);
    if (sol.estado !== "EN_COMPRAS") {
      throw new AppError(
        POR_DECIDIR.includes(sol.estado)
          ? "Ya se mandaron opciones; para cambiarlas, quien pidió tiene que pedir otras"
          : "Esta solicitud ya tiene proveedor decidido",
        409,
      );
    }
    let { rows: b } = await cliente.query(
      `SELECT id FROM compras_cotizaciones WHERE solicitud_id = $1 AND estado = 'BORRADOR'`,
      [solicitudId],
    );
    if (!b[0]) {
      ({ rows: b } = await cliente.query(
        `INSERT INTO compras_cotizaciones (solicitud_id, creada_por) VALUES ($1, $2) RETURNING id`,
        [solicitudId, usuario.id],
      ));
    }
    return { sol, borradorId: b[0].id };
  }

  /**
   * Guarda el borrador tal como está en pantalla (lo reemplaza completo).
   *
   * @param {Object} datos {
   *   mensaje, incluyeIva,
   *   partidas: [{ clave, descripcion, cantidad, unidad }],
   *   opciones: [{ proveedor, moneda, tiempoEntrega, credito, observaciones, archivoId,
   *                precios: { [clave]: { precio, descripcion, imagenId } } }]
   * }
   * Las partidas sin descripción y los proveedores sin nombre no se guardan.
   */
  static async guardarBorrador(solicitudId, usuario, datos = {}) {
    const partidas = (Array.isArray(datos.partidas) ? datos.partidas : []).filter((p) => texto(p?.descripcion, 300));
    const opciones = (Array.isArray(datos.opciones) ? datos.opciones : []).filter((o) => texto(o?.proveedor, 160));
    if (partidas.length > MAX_PARTIDAS) throw new AppError(`Máximo ${MAX_PARTIDAS} partidas`, 400);
    if (opciones.length > MAX_OPCIONES) throw new AppError(`Máximo ${MAX_OPCIONES} proveedores`, 400);

    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { borradorId } = await this.tomarParaCotizar(cliente, solicitudId, usuario);

      // Solo se aceptan archivos que se subieron a ESTE borrador
      const { rows: suyos } = await cliente.query(
        "SELECT id FROM compras_cotizacion_archivos WHERE cotizacion_id = $1",
        [borradorId],
      );
      const archivoValido = (id) => (suyos.some((a) => a.id === Number(id)) ? Number(id) : null);

      await cliente.query(
        `UPDATE compras_cotizaciones SET mensaje = $2, incluye_iva = $3, actualizada_en = now() WHERE id = $1`,
        [borradorId, texto(datos.mensaje, 2000), Boolean(datos.incluyeIva)],
      );
      await cliente.query("DELETE FROM compras_cotizacion_opciones WHERE cotizacion_id = $1", [borradorId]);
      await cliente.query("DELETE FROM compras_cotizacion_partidas WHERE cotizacion_id = $1", [borradorId]);

      const idPartida = new Map();
      for (const [i, p] of partidas.entries()) {
        const cantidad = numero(p.cantidad);
        if (Number.isNaN(cantidad) || (cantidad != null && cantidad <= 0)) {
          throw new AppError(`La cantidad de "${texto(p.descripcion, 60)}" no es válida`, 400);
        }
        const { rows } = await cliente.query(
          `INSERT INTO compras_cotizacion_partidas (cotizacion_id, orden, descripcion, cantidad, unidad)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [borradorId, i, texto(p.descripcion, 300), cantidad, texto(p.unidad, 20) || "PZS"],
        );
        idPartida.set(String(p.clave ?? i), rows[0].id);
      }

      for (const [i, o] of opciones.entries()) {
        const { rows } = await cliente.query(
          `INSERT INTO compras_cotizacion_opciones
             (cotizacion_id, orden, proveedor, moneda, tiempo_entrega, credito, observaciones, archivo_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [
            borradorId,
            i,
            texto(o.proveedor, 160),
            o.moneda === "USD" ? "USD" : "MXN",
            texto(o.tiempoEntrega, 80),
            texto(o.credito, 80),
            texto(o.observaciones, 1000),
            archivoValido(o.archivoId),
          ],
        );
        for (const [clave, pr] of Object.entries(o.precios || {})) {
          const partidaId = idPartida.get(String(clave));
          if (!partidaId) continue;
          const precio = numero(pr?.precio);
          if (Number.isNaN(precio) || (precio != null && precio < 0)) {
            throw new AppError(`El precio de ${texto(o.proveedor, 60)} no es válido`, 400);
          }
          const descripcion = texto(pr?.descripcion, 1000);
          const imagen = archivoValido(pr?.imagenId);
          if (precio == null && !descripcion && !imagen) continue;
          await cliente.query(
            `INSERT INTO compras_cotizacion_precios (opcion_id, partida_id, precio_unitario, descripcion, imagen_id)
             VALUES ($1, $2, $3, $4, $5)`,
            [rows[0].id, partidaId, precio, descripcion, imagen],
          );
        }
      }
      await cliente.query("COMMIT");
      return this.completa(borradorId);
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /** Archivos subidos al borrador (fotos y PDF de proveedores). */
  static async agregarArchivos(solicitudId, usuario, archivos) {
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { borradorId } = await this.tomarParaCotizar(cliente, solicitudId, usuario);
      const nuevos = [];
      for (const a of archivos) {
        const { rows } = await cliente.query(
          `INSERT INTO compras_cotizacion_archivos (cotizacion_id, nombre_original, ruta, tipo_mime, tamano_bytes)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre_original, tipo_mime, tamano_bytes`,
          [borradorId, a.nombreOriginal, a.ruta, a.tipoMime, a.tamanoBytes],
        );
        nuevos.push(rows[0]);
      }
      await cliente.query("COMMIT");
      return nuevos;
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /** Lo que le falta al borrador para poder mandarse; [] si está listo. */
  static faltantes(c) {
    const f = [];
    if (!c || c.partidas.length === 0) f.push("Agrega al menos una partida (lo que se va a comprar)");
    for (const p of c?.partidas || []) if (p.cantidad == null) f.push(`Falta la cantidad de "${p.descripcion}"`);
    if (!c || c.opciones.length === 0) f.push("Agrega al menos un proveedor");
    for (const o of c?.opciones || []) if (o.cotizadas === 0) f.push(`${o.proveedor} no tiene ningún precio`);
    return f;
  }

  /** Manda el borrador al solicitante. */
  static async enviar(solicitudId, usuario) {
    const cliente = await db.pool.connect();
    let huerfanos = [];
    try {
      await cliente.query("BEGIN");
      const { sol, borradorId } = await this.tomarParaCotizar(cliente, solicitudId, usuario);
      const c = await this.completa(borradorId);
      const falta = this.faltantes(c);
      if (falta.length) throw new AppError(`Todavía no se puede mandar: ${falta.join("; ")}.`, 400);

      // Fotos o PDF que se subieron pero ya no se usan
      const { rows: sobran } = await cliente.query(
        `DELETE FROM compras_cotizacion_archivos a
          WHERE a.cotizacion_id = $1
            AND NOT EXISTS (SELECT 1 FROM compras_cotizacion_opciones o WHERE o.archivo_id = a.id)
            AND NOT EXISTS (SELECT 1 FROM compras_cotizacion_precios p WHERE p.imagen_id = a.id)
          RETURNING ruta`,
        [borradorId],
      );
      huerfanos = sobran.map((r) => r.ruta);

      await cliente.query(
        `UPDATE compras_cotizaciones SET estado = 'ENVIADA', enviada_por = $2, enviada_en = now() WHERE id = $1`,
        [borradorId, usuario.id],
      );
      await cliente.query(`UPDATE compras_solicitudes SET estado = 'COTIZADA' WHERE id = $1`, [solicitudId]);
      await evento(cliente, {
        solicitudId,
        tipo: "COTIZADA",
        usuarioId: usuario.id,
        detalle: `${c.opciones.length} opción(es): ${c.opciones.map((o) => `${o.proveedor} ${dinero(o.total, o.moneda)}`).join(" · ")}`,
      });
      await cliente.query("COMMIT");
      return { id: solicitudId, folio: sol.folio, estado: "COTIZADA", opciones: c.opciones.length };
    } catch (e) {
      await cliente.query("ROLLBACK");
      huerfanos = [];
      throw e;
    } finally {
      cliente.release();
      for (const r of huerfanos) fs.unlink(rutaAbsoluta(r), () => {});
    }
  }

  /** Bloquea la solicitud para el solicitante mientras Compras no decide. */
  static async tomarParaSugerir(cliente, solicitudId, usuario) {
    const { rows } = await cliente.query(
      `SELECT s.id, s.folio, s.estado, s.solicitante_id, s.compras_area_id, c.id AS cotizacion_id
         FROM compras_solicitudes s
         LEFT JOIN compras_cotizaciones c ON c.solicitud_id = s.id AND c.estado = 'ENVIADA'
        WHERE s.id = $1 FOR UPDATE OF s`,
      [solicitudId],
    );
    const sol = rows[0];
    if (!sol || sol.solicitante_id !== usuario.id) throw new AppError("La solicitud no existe", 404);
    if (!POR_DECIDIR.includes(sol.estado) || !sol.cotizacion_id) {
      throw new AppError(
        sol.estado === "DECIDIDA"
          ? "Compras ya decidió la opción de esta solicitud"
          : "Esta solicitud no tiene opciones esperando tu sugerencia",
        409,
      );
    }
    return sol;
  }

  /**
   * El solicitante sugiere una opción con su opinión técnica. Mientras Compras
   * no decide, la puede cambiar.
   */
  static async sugerir(solicitudId, usuario, { opcionId, comentario }) {
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const sol = await this.tomarParaSugerir(cliente, solicitudId, usuario);
      const c = await this.completa(sol.cotizacion_id);
      const op = c.opciones.find((o) => o.id === Number(opcionId));
      if (!op) throw new AppError("Esa opción no es de esta cotización", 400);
      const nota = texto(comentario, 1000);
      await cliente.query(
        `UPDATE compras_solicitudes
            SET estado = 'SUGERIDA', opcion_sugerida_id = $2, sugerencia = $3, sugerido_en = now()
          WHERE id = $1`,
        [solicitudId, op.id, nota],
      );
      await evento(cliente, {
        solicitudId,
        tipo: "SUGERIDA",
        usuarioId: usuario.id,
        detalle: `${op.proveedor} · ${dinero(op.total, op.moneda)}${nota ? ` — ${nota}` : ""}`,
      });
      await cliente.query("COMMIT");
      return { id: solicitudId, folio: sol.folio, estado: "SUGERIDA", proveedor: op.proveedor, cambio: sol.estado === "SUGERIDA" };
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /**
   * Compras decide la opción. Puede ser otra que la sugerida (diciendo por qué)
   * o sin esperar la sugerencia. No descuenta presupuesto.
   */
  static async decidir(solicitudId, usuario, { opcionId, nota }) {
    const alcance = await this.alcance(usuario);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows } = await cliente.query(
        `SELECT s.id, s.folio, s.estado, s.asignado_email, s.opcion_sugerida_id, c.id AS cotizacion_id
           FROM compras_solicitudes s
           LEFT JOIN compras_cotizaciones c ON c.solicitud_id = s.id AND c.estado = 'ENVIADA'
          WHERE s.id = $1 FOR UPDATE OF s`,
        [solicitudId],
      );
      const sol = rows[0];
      if (!sol || !this.leToca(sol, alcance)) throw new AppError("La solicitud no existe", 404);
      if (!alcance.cotizar) throw new AppError("No tienes permiso para decidir cotizaciones", 403);
      if (!POR_DECIDIR.includes(sol.estado) || !sol.cotizacion_id) {
        throw new AppError(
          ["DECIDIDA", "ELEGIDA"].includes(sol.estado)
            ? "Esta solicitud ya tiene proveedor decidido"
            : "Esta solicitud no tiene opciones enviadas",
          409,
        );
      }
      const c = await this.completa(sol.cotizacion_id);
      const op = c.opciones.find((o) => o.id === Number(opcionId));
      if (!op) throw new AppError("Esa opción no es de esta cotización", 400);
      const razon = texto(nota, 1000);
      const otraQueLaSugerida = sol.opcion_sugerida_id && sol.opcion_sugerida_id !== op.id;
      if (otraQueLaSugerida && !razon) {
        throw new AppError("Escribe por qué decides otra opción que la que sugirió quien pidió", 400);
      }
      await cliente.query(
        `UPDATE compras_solicitudes
            SET estado = 'DECIDIDA', opcion_elegida_id = $2, monto_elegido = $3, moneda_elegida = $4,
                elegido_en = now(), elegido_por = $5, decision_nota = $6
          WHERE id = $1`,
        [solicitudId, op.id, op.total, op.moneda, usuario.id, razon],
      );
      const como = !sol.opcion_sugerida_id ? " (sin esperar sugerencia)" : otraQueLaSugerida ? " (otra que la sugerida)" : "";
      await evento(cliente, {
        solicitudId,
        tipo: "DECIDIDA",
        usuarioId: usuario.id,
        detalle: `${op.proveedor} · ${dinero(op.total, op.moneda)}${c.incluye_iva ? " con IVA" : " + IVA"}${como}${razon ? ` — ${razon}` : ""}`,
      });
      await cliente.query("COMMIT");
      return { id: solicitudId, folio: sol.folio, estado: "DECIDIDA", proveedor: op.proveedor, monto: op.total, moneda: op.moneda };
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /** Ninguna opción le sirve: regresa a Compras con el motivo. */
  static async pedirOtras(solicitudId, usuario, { motivo }) {
    const razon = texto(motivo, 1000);
    if (!razon) throw new AppError("Escribe por qué ninguna opción te sirve", 400);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const sol = await this.tomarParaSugerir(cliente, solicitudId, usuario);
      await cliente.query(
        `UPDATE compras_cotizaciones SET estado = 'DESCARTADA', descartada_en = now(), motivo_descarte = $2 WHERE id = $1`,
        [sol.cotizacion_id, razon],
      );
      await cliente.query(
        `UPDATE compras_solicitudes
            SET estado = 'EN_COMPRAS', opcion_sugerida_id = NULL, sugerencia = NULL, sugerido_en = NULL
          WHERE id = $1`,
        [solicitudId],
      );
      await evento(cliente, { solicitudId, tipo: "OTRAS_OPCIONES", usuarioId: usuario.id, detalle: razon });
      await cliente.query("COMMIT");
      return { id: solicitudId, folio: sol.folio, estado: "EN_COMPRAS" };
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /**
   * Un archivo de cotización. Lo ve Compras (a quien le toca) y, una vez
   * enviada, quien pidió, su gerente y su suplente.
   */
  static async obtenerArchivo(archivoId, usuario) {
    const { rows } = await db.query(
      `SELECT a.nombre_original, a.ruta, a.tipo_mime, c.estado AS cotizacion_estado,
              s.solicitante_id, s.asignado_email, ca.gerente_id, ca.suplente_id
         FROM compras_cotizacion_archivos a
         JOIN compras_cotizaciones c ON c.id = a.cotizacion_id
         JOIN compras_solicitudes s ON s.id = c.solicitud_id
         JOIN compras_areas ca ON ca.id = s.compras_area_id
        WHERE a.id = $1`,
      [archivoId],
    );
    const a = rows[0];
    if (!a) throw new AppError("El archivo no existe", 404);
    const delArea = [a.solicitante_id, a.gerente_id, a.suplente_id].includes(usuario.id) || esAdmin(usuario);
    const deCompras =
      (await permiso(usuario, "puede_leer")) && this.leToca(a, await this.alcance(usuario));
    if (!(deCompras || (delArea && a.cotizacion_estado !== "BORRADOR"))) {
      throw new AppError("El archivo no existe", 404);
    }
    return a;
  }

  /** Un adjunto de la solicitud, visto desde Compras. */
  static async obtenerArchivoSolicitud(solicitudId, archivoId, usuario) {
    await this.obtener(solicitudId, usuario);
    const { rows } = await db.query(
      `SELECT nombre_original, ruta, tipo_mime FROM compras_solicitud_archivos WHERE id = $1 AND solicitud_id = $2`,
      [archivoId, solicitudId],
    );
    if (!rows[0]) throw new AppError("El archivo no existe", 404);
    return rows[0];
  }
}

module.exports = CompraCotizacion;
