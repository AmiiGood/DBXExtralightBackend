const db = require("../config/database");
const RolModulo = require("./RolModulo");
const Firma = require("./Firma");
const Presupuesto = require("./CompraPresupuesto");
const tipoCambio = require("../services/tipoCambio.service");
const { AppError } = require("../utils/errorHandler");

/**
 * La orden de compra con sus cuatro firmas (fase 3 del flujo con firmas).
 *
 * Ver migrations/2026-11-13_compras_solicitudes_13_orden_compra.sql. En corto:
 *
 *   DECIDIDA → quien pidió la envía → firma el gerente (o suplente) → firma el
 *   jefe de Compras con el tipo → firma Finanzas con la cuenta y el CC → firma
 *   Dirección (si el monto llega al mínimo) → AUTORIZADA, y se descuenta del
 *   presupuesto del área. Cualquier rechazo la termina (NO_AUTORIZADA).
 *
 * Quién firma NO depende del rol ni del módulo: el gerente sale del área y los
 * demás de compras_firmantes. El módulo /compras/ordenes solo da la entrada en
 * el menú y, con editar, ver todas.
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
    // El suplente que pidió necesita al gerente; nadie se firma a sí mismo aquí
    if (propia) return { puede: false, porque: "No puedes firmar como gerente tu propia orden" };
    if (o.gerente_id === usuario.id) return { puede: true, como: "GERENTE" };
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
         s.folio, s.asunto, s.detalle, s.osticket_numero, s.asignado_nombre, s.solicitante_id,
         s.compras_area_id, s.monto_presupuesto::float AS monto_presupuesto,
         ca.nombre AS area_nombre, ca.gerente_id, ca.suplente_id,
         us.nombre_completo AS solicitante_nombre
    FROM compras_ordenes o
    JOIN compras_solicitudes s ON s.id = o.solicitud_id
    JOIN compras_areas ca ON ca.id = s.compras_area_id
    JOIN usuarios us ON us.id = s.solicitante_id
    LEFT JOIN usuarios ur ON ur.id = o.rechazada_por
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
  // Enviar
  // =========================================================================

  /**
   * Quien pidió envía la orden de compra de lo que decidió Compras. Si es el
   * gerente del área, firma al enviarla (con su PIN).
   */
  static async enviar(solicitudId, usuario, { comentario, pin } = {}) {
    const nota = texto(comentario, 1000);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows } = await cliente.query(
        `SELECT s.id, s.folio, s.estado, s.solicitante_id, s.opcion_elegida_id, s.monto_elegido::float AS monto,
                s.moneda_elegida, ca.gerente_id, ca.suplente_id, ca.activo AS area_activa,
                op.proveedor, c.incluye_iva
           FROM compras_solicitudes s
           JOIN compras_areas ca ON ca.id = s.compras_area_id
           LEFT JOIN compras_cotizacion_opciones op ON op.id = s.opcion_elegida_id
           LEFT JOIN compras_cotizaciones c ON c.id = op.cotizacion_id
          WHERE s.id = $1 FOR UPDATE OF s`,
        [solicitudId],
      );
      const s = rows[0];
      if (!s || s.solicitante_id !== usuario.id) throw new AppError("La solicitud no existe", 404);
      if (s.estado !== "DECIDIDA") {
        throw new AppError(
          ["EN_FIRMAS", "AUTORIZADA", "NO_AUTORIZADA"].includes(s.estado)
            ? "La orden de compra de esta solicitud ya se envió"
            : "Solo se envía la orden de compra cuando Compras ya decidió la opción",
          409,
        );
      }
      if (!s.opcion_elegida_id || s.monto == null) throw new AppError("La solicitud no tiene opción decidida", 409);

      const esGerente = s.gerente_id === usuario.id;
      if (!esGerente && !s.gerente_id) {
        throw new AppError("Tu área no tiene gerente registrado: nadie podría firmar la orden. Avísale al administrador.", 409);
      }

      let firma = null;
      if (esGerente) {
        if (!pin) throw new AppError("Eres el gerente del área: confirma la orden con tu PIN de firma", 400);
        firma = await Firma.verificar(usuario.id, pin, cliente);
      }

      const { rows: o } = await cliente.query(
        `INSERT INTO compras_ordenes (solicitud_id, paso, opcion_id, proveedor, monto, moneda, incluye_iva, comentario, enviada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [solicitudId, esGerente ? "COMPRAS" : "GERENTE", s.opcion_elegida_id, s.proveedor, s.monto, s.moneda_elegida,
          Boolean(s.incluye_iva), nota, usuario.id],
      );
      const ordenId = o[0].id;
      if (firma) {
        await cliente.query(
          `INSERT INTO compras_orden_firmas (orden_id, paso, usuario_id, firma_id, como) VALUES ($1, 'GERENTE', $2, $3, 'PROPIA')`,
          [ordenId, usuario.id, firma.id],
        );
      }
      await cliente.query("UPDATE compras_solicitudes SET estado = 'EN_FIRMAS' WHERE id = $1", [solicitudId]);
      await evento(cliente, {
        solicitudId,
        tipo: "OC_ENVIADA",
        usuarioId: usuario.id,
        como: esGerente ? "PROPIA" : null,
        detalle: `${s.proveedor} · ${dinero(s.monto, s.moneda_elegida)}${s.incluye_iva ? " con IVA" : " + IVA"}${nota ? ` — ${nota}` : ""}`,
      });
      await cliente.query("COMMIT");
      return { id: ordenId, solicitudId, folio: s.folio, paso: esGerente ? "COMPRAS" : "GERENTE", firmada: Boolean(firma) };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23505") throw new AppError("La orden de compra de esta solicitud ya se envió", 409);
      throw e;
    } finally {
      cliente.release();
    }
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
      where = `o.estado = 'EN_FIRMAS' AND s.solicitante_id <> $1
               AND ((o.paso = 'GERENTE' AND (ca.gerente_id = $1 OR ca.suplente_id = $1))
                    OR (o.paso <> 'GERENTE' AND o.paso = ANY($2)))`;
      orden = "o.enviada_en ASC";
    } else if (vista === "firmadas") {
      where = `(EXISTS (SELECT 1 FROM compras_orden_firmas f WHERE f.orden_id = o.id AND f.usuario_id = $1)
                OR o.rechazada_por = $1)`;
    } else if (vista === "todas") {
      if (!(await verTodas(usuario))) throw new AppError("No tienes permiso para ver todas las órdenes", 403);
      where = "true";
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
        WHERE o.estado = 'EN_FIRMAS' AND s.solicitante_id <> $1
          AND ((o.paso = 'GERENTE' AND (ca.gerente_id = $1 OR ca.suplente_id = $1))
               OR (o.paso <> 'GERENTE' AND o.paso = ANY($2)))`,
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

  /** La orden de una solicitud, para la pantalla de Solicitudes (resumen y firmas). */
  static async deSolicitud(solicitudId) {
    const { rows } = await db.query(`${SELECT_ORDEN} WHERE o.solicitud_id = $1`, [solicitudId]);
    if (!rows[0]) return null;
    return { ...rows[0], firmas: await this.firmas(rows[0].id) };
  }

  /**
   * Una orden con todo lo que hace falta para firmarla: la cotización, el
   * presupuesto del área, las firmas y, si le toca al usuario, las listas de
   * tipos o cuentas.
   */
  static async obtener(ordenId, usuario) {
    const { rows } = await db.query(`${SELECT_ORDEN} WHERE o.id = $1`, [ordenId]);
    const o = rows[0];
    if (!o) throw new AppError("La orden no existe", 404);

    const papeles = await papelesDe(usuario.id);
    const { rows: firmo } = await db.query(
      "SELECT 1 FROM compras_orden_firmas WHERE orden_id = $1 AND usuario_id = $2",
      [ordenId, usuario.id],
    );
    const puedeVer =
      [o.solicitante_id, o.gerente_id, o.suplente_id].includes(usuario.id) ||
      papeles.size > 0 ||
      firmo.length > 0 ||
      (await verTodas(usuario)) ||
      (o.estado === "AUTORIZADA" && (await leeFormatos(usuario)));
    if (!puedeVer) throw new AppError("La orden no existe", 404);

    const turno = puedeFirmar(usuario, o, papeles);
    const Cotizacion = require("./CompraCotizacion");
    const { rows: cot } = await db.query("SELECT cotizacion_id FROM compras_cotizacion_opciones WHERE id = $1", [o.opcion_id]);

    const [firmas, cotizacion, saldo, catalogos, iva, tc] = await Promise.all([
      this.firmas(ordenId),
      cot[0] ? Cotizacion.completa(cot[0].cotizacion_id) : null,
      Presupuesto.saldoActual(o.compras_area_id),
      turno.puede && ["COMPRAS", "FINANZAS"].includes(o.paso) ? this.catalogos() : null,
      Presupuesto.ivaTasa(),
      tipoCambio.ultimo(),
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
      cotizacion,
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
      throw new AppError(o.estado === "AUTORIZADA" ? "La orden ya quedó autorizada" : "La orden ya fue rechazada", 409);
    }
    const turno = puedeFirmar(usuario, o, await papelesDe(usuario.id, cliente));
    if (!turno.puede) throw new AppError(turno.porque, 403);
    return { o, como: turno.como };
  }

  /**
   * Firma el paso en que va la orden.
   * @param {Object} d { pin, tipo (Compras), cuenta y centroCostos (Finanzas), comentario }
   */
  static async firmar(ordenId, usuario, d = {}) {
    const nota = texto(d.comentario, 1000);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { o, como } = await this.tomar(cliente, ordenId, usuario);

      // Lo que pone cada quien, antes de pedir el PIN: si falta algo no gasta intento
      const cambios = {};
      if (o.paso === "COMPRAS") {
        const tipo = String(d.tipo ?? "").replace(/\s+/g, " ").trim();
        if (!tipo) throw new AppError("Escoge el tipo de compra antes de firmar", 400);
        const { rows } = await cliente.query("SELECT nombre FROM compras_tipos WHERE activo AND lower(nombre) = lower($1)", [tipo]);
        if (!rows[0]) throw new AppError(`"${tipo}" no está en la lista de tipos`, 400);
        cambios.clasif_tipo = rows[0].nombre;
      }
      if (o.paso === "FINANZAS") {
        const cuenta = String(d.cuenta ?? "").replace(/\D/g, "");
        if (!cuenta) throw new AppError("Escoge la cuenta antes de firmar", 400);
        const { rows } = await cliente.query("SELECT codigo FROM compras_cuentas WHERE activo AND codigo = $1", [cuenta]);
        if (!rows[0]) throw new AppError(`La cuenta ${cuenta} no está en la lista`, 400);
        cambios.cuenta = cuenta;
        cambios.centro_costos = texto(d.centroCostos, 60);
      }

      if (!d.pin) throw new AppError("Escribe tu PIN de firma", 400);
      const firma = await Firma.verificar(usuario.id, d.pin, cliente);

      await cliente.query(
        `INSERT INTO compras_orden_firmas (orden_id, paso, usuario_id, firma_id, como, comentario)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ordenId, o.paso, usuario.id, firma.id, como, nota],
      );

      // ¿Qué sigue?
      let siguiente = PASOS[PASOS.indexOf(o.paso) + 1] || null;
      if (o.paso === "FINANZAS") {
        const [{ rows: cfg }, iva, tc] = await Promise.all([
          cliente.query("SELECT oc_monto_minimo_direccion::float AS minimo FROM compras_config WHERE id = 1"),
          Presupuesto.ivaTasa(cliente),
          tipoCambio.ultimo(),
        ]);
        const minimo = cfg[0]?.minimo ?? 0;
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
        await cliente.query(`UPDATE compras_ordenes SET ${sets.join(", ")} WHERE id = $1`, [ordenId, ...Object.values(cambios)]);
      }

      const detalle = [
        cambios.clasif_tipo && `Tipo: ${cambios.clasif_tipo}`,
        cambios.cuenta && `Cuenta: ${cambios.cuenta}${cambios.centro_costos ? ` · CC: ${cambios.centro_costos}` : ""}`,
        o.paso === "FINANZAS" && !cambios.requiere_direccion &&
          `Abajo del mínimo para Dirección (${dinero(cambios.monto_minimo_direccion, "MXN")})`,
        nota,
      ].filter(Boolean).join(" — ");
      await evento(cliente, { solicitudId: o.solicitud_id, tipo: `OC_FIRMA_${o.paso}`, usuarioId: usuario.id, como, detalle: detalle || null });

      let autorizada = false;
      if (siguiente) {
        await cliente.query("UPDATE compras_ordenes SET paso = $2 WHERE id = $1", [ordenId, siguiente]);
      } else {
        await this.autorizar(cliente, o, usuario);
        autorizada = true;
      }

      await cliente.query("COMMIT");
      return { id: ordenId, solicitudId: o.solicitud_id, folio: o.folio, paso: o.paso, siguiente, autorizada };
    } catch (e) {
      await cliente.query("ROLLBACK");
      if (e.code === "23505") throw new AppError("Ese paso ya está firmado", 409);
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
