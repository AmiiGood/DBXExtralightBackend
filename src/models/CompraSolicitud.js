const db = require("../config/database");
const { AppError } = require("../utils/errorHandler");

/**
 * Solicitudes de Compra con aprobación del gerente.
 *
 * Reglas (ver migrations/2026-10-02_compras_solicitudes_01_schema.sql):
 *
 *   - El área sale del usuario: areas.compras_area_id. Sin área o sin gerente
 *     no se puede pedir, porque nadie vería la solicitud.
 *   - Aprueba el gerente o el suplente ACTUAL del área, nunca quien la pidió.
 *   - Si quien pide es el gerente, la solicitud nace aprobada: él es la
 *     autorización del área. Queda en la bitácora como decisión "PROPIA".
 *   - Si quien pide es el suplente, la tiene que aprobar el gerente.
 */

const ESTADOS = ["PENDIENTE", "APROBADA", "RECHAZADA", "CANCELADA", "EN_COMPRAS"];

// Fechas como texto en hora de planta: la conexión ya trae la zona de México y
// así no las mueve el JSON del navegador.
const F = (col) => `to_char(${col}, 'YYYY-MM-DD"T"HH24:MI:SS')`;

const SELECT_SOLICITUD = `
  SELECT s.id, s.folio, s.asunto, s.detalle, s.estado, s.comentario,
         ${F("s.creado_en")}   AS creado_en,
         ${F("s.decidido_en")} AS decidido_en,
         ${F("s.enviado_en")}  AS enviado_en,
         s.osticket_numero,
         s.intentos_envio,
         s.ultimo_error_envio,
         s.compras_area_id,
         ca.nombre             AS area_nombre,
         s.solicitante_id,
         us.nombre_completo    AS solicitante_nombre,
         s.decidido_por,
         ud.nombre_completo    AS decidido_por_nombre,
         ca.gerente_id, ca.suplente_id,
         (SELECT count(*)::int FROM compras_solicitud_archivos f WHERE f.solicitud_id = s.id) AS archivos
    FROM compras_solicitudes s
    JOIN compras_areas ca ON ca.id = s.compras_area_id
    JOIN usuarios us      ON us.id = s.solicitante_id
    LEFT JOIN usuarios ud ON ud.id = s.decidido_por
`;

/** Qué papel tiene un usuario frente a una solicitud. */
function papel(usuario, sol) {
  const esSolicitante = sol.solicitante_id === usuario.id;
  const esGerente = sol.gerente_id === usuario.id;
  const esSuplente = sol.suplente_id === usuario.id;
  return {
    esSolicitante,
    // Nadie se aprueba a sí mismo
    puedeDecidir: (esGerente || esSuplente) && !esSolicitante,
    como: esGerente ? "GERENTE" : esSuplente ? "SUPLENTE" : null,
    puedeVer: esSolicitante || esGerente || esSuplente || Boolean(usuario.rol?.esAdmin),
  };
}

async function registrarEvento(cliente, { solicitudId, tipo, usuarioId, como = null, detalle = null }) {
  await cliente.query(
    `INSERT INTO compras_solicitud_eventos (solicitud_id, tipo, usuario_id, como, detalle)
     VALUES ($1, $2, $3, $4, $5)`,
    [solicitudId, tipo, usuarioId, como, detalle],
  );
}

class CompraSolicitud {
  static ESTADOS = ESTADOS;

  /**
   * Área de Compras del usuario y quién le aprueba. `null` si su área de DBX
   * no está ligada a ninguna.
   */
  static async areaDelUsuario(usuarioId) {
    const { rows } = await db.query(
      `SELECT ca.id, ca.nombre, ca.activo,
              ca.gerente_id,  g.nombre_completo AS gerente_nombre,
              ca.suplente_id, p.nombre_completo AS suplente_nombre,
              a.nombre AS area_dbx
         FROM usuarios u
         JOIN areas a          ON a.id = u.area_id
         JOIN compras_areas ca ON ca.id = a.compras_area_id
         LEFT JOIN usuarios g  ON g.id = ca.gerente_id AND g.activo
         LEFT JOIN usuarios p  ON p.id = ca.suplente_id AND p.activo
        WHERE u.id = $1`,
      [usuarioId],
    );
    return rows[0] || null;
  }

  /** Áreas en las que el usuario es gerente o suplente. */
  static async areasQueAprueba(usuarioId) {
    const { rows } = await db.query(
      `SELECT id, nombre,
              CASE WHEN gerente_id = $1 THEN 'GERENTE' ELSE 'SUPLENTE' END AS como
         FROM compras_areas
        WHERE activo AND (gerente_id = $1 OR suplente_id = $1)
        ORDER BY nombre`,
      [usuarioId],
    );
    return rows;
  }

  /**
   * Crea la solicitud con sus archivos en una sola transacción.
   *
   * @param {Object}   usuario   req.usuario
   * @param {Object}   datos     { asunto, detalle }
   * @param {Object[]} archivos  [{ nombreOriginal, ruta, tipoMime, tamanoBytes }]
   *                             ya escritos en disco; si algo falla aquí, quien
   *                             llama los borra.
   */
  static async crear(usuario, { asunto, detalle }, archivos = []) {
    const area = await this.areaDelUsuario(usuario.id);
    if (!area || !area.activo) {
      throw new AppError(
        "Tu área no está dada de alta para pedir a Compras. Pídele a TI que la configure.",
        409,
      );
    }
    if (!area.gerente_id) {
      throw new AppError(
        `El área "${area.nombre}" todavía no tiene quién apruebe. Pídele a TI que la configure.`,
        409,
      );
    }

    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");

      const { rows } = await cliente.query(
        `INSERT INTO compras_solicitudes (solicitante_id, compras_area_id, asunto, detalle)
         VALUES ($1, $2, $3, $4)
         RETURNING id, folio`,
        [usuario.id, area.id, asunto, detalle],
      );
      const { id, folio } = rows[0];

      for (const a of archivos) {
        await cliente.query(
          `INSERT INTO compras_solicitud_archivos
             (solicitud_id, nombre_original, ruta, tipo_mime, tamano_bytes)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, a.nombreOriginal, a.ruta, a.tipoMime, a.tamanoBytes],
        );
      }

      await registrarEvento(cliente, { solicitudId: id, tipo: "CREADA", usuarioId: usuario.id });

      // El gerente que pide para su propia área ya es la autorización
      let estado = "PENDIENTE";
      if (area.gerente_id === usuario.id) {
        estado = "APROBADA";
        await cliente.query(
          `UPDATE compras_solicitudes
              SET estado = 'APROBADA', decidido_por = $2, decidido_en = now()
            WHERE id = $1`,
          [id, usuario.id],
        );
        await registrarEvento(cliente, {
          solicitudId: id,
          tipo: "APROBADA",
          usuarioId: usuario.id,
          como: "PROPIA",
          detalle: "La pidió el gerente del área",
        });
      }

      await cliente.query("COMMIT");
      return { id, folio, estado, area: area.nombre };
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  }

  /** Lo que pidió el usuario, lo más reciente primero. */
  static async listarMias(usuarioId, { estado, limite = 200 } = {}) {
    const valores = [usuarioId];
    let filtro = "";
    if (estado) {
      valores.push(estado);
      filtro = ` AND s.estado = $${valores.length}`;
    }
    valores.push(limite);
    const { rows } = await db.query(
      `${SELECT_SOLICITUD}
        WHERE s.solicitante_id = $1${filtro}
        ORDER BY s.creado_en DESC
        LIMIT $${valores.length}`,
      valores,
    );
    return rows;
  }

  /**
   * La bandeja del gerente o suplente.
   *
   * @param {String} vista  'pendientes' (lo que espera, lo más viejo primero)
   *                        o 'decididas' (historial, lo más reciente primero)
   */
  static async listarBandeja(usuarioId, { vista = "pendientes", limite = 200 } = {}) {
    const pendientes = vista === "pendientes";
    const { rows } = await db.query(
      `${SELECT_SOLICITUD}
        WHERE (ca.gerente_id = $1 OR ca.suplente_id = $1)
          AND s.solicitante_id <> $1
          AND ${pendientes ? "s.estado = 'PENDIENTE'" : "s.estado NOT IN ('PENDIENTE', 'CANCELADA')"}
        ORDER BY ${pendientes ? "s.creado_en ASC" : "s.decidido_en DESC NULLS LAST"}
        LIMIT $2`,
      [usuarioId, limite],
    );
    return rows;
  }

  /** Cuántas esperan al usuario. Para el contador de la pestaña. */
  static async contarPendientes(usuarioId) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n
         FROM compras_solicitudes s
         JOIN compras_areas ca ON ca.id = s.compras_area_id
        WHERE s.estado = 'PENDIENTE'
          AND (ca.gerente_id = $1 OR ca.suplente_id = $1)
          AND s.solicitante_id <> $1`,
      [usuarioId],
    );
    return rows[0].n;
  }

  /**
   * Una solicitud con sus archivos y su bitácora. Revisa que el usuario la
   * pueda ver; si no, responde como si no existiera.
   */
  static async obtener(id, usuario) {
    const { rows } = await db.query(`${SELECT_SOLICITUD} WHERE s.id = $1`, [id]);
    const sol = rows[0];
    if (!sol) throw new AppError("La solicitud no existe", 404);

    const p = papel(usuario, sol);
    if (!p.puedeVer) throw new AppError("La solicitud no existe", 404);

    const [archivos, eventos] = await Promise.all([
      db.query(
        `SELECT id, nombre_original, tipo_mime, tamano_bytes
           FROM compras_solicitud_archivos
          WHERE solicitud_id = $1
          ORDER BY id`,
        [id],
      ),
      db.query(
        `SELECT e.tipo, e.como, e.detalle, ${F("e.creado_en")} AS creado_en,
                u.nombre_completo AS usuario_nombre
           FROM compras_solicitud_eventos e
           LEFT JOIN usuarios u ON u.id = e.usuario_id
          WHERE e.solicitud_id = $1
          ORDER BY e.creado_en, e.id`,
        [id],
      ),
    ]);

    return {
      ...sol,
      archivos: archivos.rows,
      eventos: eventos.rows,
      permisos: {
        decidir: p.puedeDecidir && sol.estado === "PENDIENTE",
        cancelar: p.esSolicitante && sol.estado === "PENDIENTE",
      },
    };
  }

  /** Datos de un archivo, solo si el usuario puede ver su solicitud. */
  static async obtenerArchivo(solicitudId, archivoId, usuario) {
    await this.obtener(solicitudId, usuario);
    const { rows } = await db.query(
      `SELECT nombre_original, ruta, tipo_mime
         FROM compras_solicitud_archivos
        WHERE id = $1 AND solicitud_id = $2`,
      [archivoId, solicitudId],
    );
    if (!rows[0]) throw new AppError("El archivo no existe", 404);
    return rows[0];
  }

  /**
   * Aprueba o rechaza.
   *
   * Bloquea el renglón: si el gerente y el suplente deciden al mismo tiempo,
   * el segundo se encuentra con que ya no está pendiente.
   */
  static async decidir(id, usuario, { aprobar, comentario }) {
    const texto = (comentario || "").trim();
    if (!aprobar && !texto) {
      throw new AppError("Escribe el motivo del rechazo", 400);
    }

    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows } = await cliente.query(
        `SELECT s.id, s.folio, s.estado, s.solicitante_id, ca.gerente_id, ca.suplente_id
           FROM compras_solicitudes s
           JOIN compras_areas ca ON ca.id = s.compras_area_id
          WHERE s.id = $1
            FOR UPDATE OF s`,
        [id],
      );
      const sol = rows[0];
      if (!sol) throw new AppError("La solicitud no existe", 404);

      const p = papel(usuario, sol);
      if (!p.puedeDecidir) {
        throw new AppError(
          p.esSolicitante
            ? "No puedes aprobar tu propia solicitud"
            : "No eres quien aprueba las solicitudes de esta área",
          403,
        );
      }
      if (sol.estado !== "PENDIENTE") {
        throw new AppError(`La solicitud ya no está pendiente (${sol.estado.toLowerCase()})`, 409);
      }

      const estado = aprobar ? "APROBADA" : "RECHAZADA";
      await cliente.query(
        `UPDATE compras_solicitudes
            SET estado = $2, decidido_por = $3, decidido_en = now(), comentario = $4
          WHERE id = $1`,
        [id, estado, usuario.id, texto || null],
      );
      await registrarEvento(cliente, {
        solicitudId: id,
        tipo: estado,
        usuarioId: usuario.id,
        como: p.como,
        detalle: texto || null,
      });

      await cliente.query("COMMIT");
      return { id, folio: sol.folio, estado };
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  }

  /** Quien pidió la retira, mientras nadie la haya decidido. */
  static async cancelar(id, usuario) {
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rows } = await cliente.query(
        `SELECT id, folio, estado, solicitante_id FROM compras_solicitudes WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const sol = rows[0];
      if (!sol || sol.solicitante_id !== usuario.id) {
        throw new AppError("La solicitud no existe", 404);
      }
      if (sol.estado !== "PENDIENTE") {
        throw new AppError("Solo se puede cancelar mientras está pendiente", 409);
      }
      await cliente.query(`UPDATE compras_solicitudes SET estado = 'CANCELADA' WHERE id = $1`, [id]);
      await registrarEvento(cliente, { solicitudId: id, tipo: "CANCELADA", usuarioId: usuario.id });
      await cliente.query("COMMIT");
      return { id, folio: sol.folio, estado: "CANCELADA" };
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  }

  /** Aprobadas que todavía no son ticket, lo más viejo primero. */
  static async listarPorEnviar() {
    const { rows } = await db.query(
      `${SELECT_SOLICITUD}
        WHERE s.estado = 'APROBADA'
        ORDER BY s.decidido_en`,
    );
    return rows;
  }

  // =========================================================================
  // Configuración: quién aprueba cada área
  // =========================================================================

  static async listarAreas() {
    const { rows } = await db.query(
      `SELECT ca.id, ca.nombre, ca.osticket_topic_id, ca.activo,
              ca.gerente_id,  g.nombre_completo AS gerente_nombre,
              ca.suplente_id, p.nombre_completo AS suplente_nombre,
              ${F("ca.actualizado_en")} AS actualizado_en,
              coalesce(
                (SELECT json_agg(json_build_object('id', a.id, 'nombre', a.nombre) ORDER BY a.nombre)
                   FROM areas a WHERE a.compras_area_id = ca.id),
                '[]'
              ) AS areas_dbx,
              (SELECT count(*)::int FROM compras_solicitudes s
                WHERE s.compras_area_id = ca.id AND s.estado = 'PENDIENTE') AS pendientes
         FROM compras_areas ca
         LEFT JOIN usuarios g ON g.id = ca.gerente_id
         LEFT JOIN usuarios p ON p.id = ca.suplente_id
        ORDER BY ca.nombre`,
    );
    return rows;
  }

  /**
   * Usuarios activos para los selectores, con aviso de si su rol puede abrir
   * el módulo: un gerente sin ese permiso no vería su bandeja.
   */
  static async usuariosParaAprobar(rutaModulo) {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre_completo, u.nombre_usuario, r.nombre AS rol, a.nombre AS area,
              (r.es_admin OR EXISTS (
                 SELECT 1 FROM roles_modulos rm JOIN modulos m ON m.id = rm.modulo_id
                  WHERE rm.rol_id = u.rol_id AND m.ruta = $1 AND rm.puede_leer
              )) AS tiene_modulo
         FROM usuarios u
         LEFT JOIN roles r ON r.id = u.rol_id
         LEFT JOIN areas a ON a.id = u.area_id
        WHERE u.activo
        ORDER BY u.nombre_completo`,
      [rutaModulo],
    );
    return rows;
  }

  /** Áreas de DBX y a qué área de Compras cargan. */
  static async listarAreasDbx() {
    const { rows } = await db.query(
      `SELECT a.id, a.nombre, a.compras_area_id,
              (SELECT count(*)::int FROM usuarios u WHERE u.area_id = a.id AND u.activo) AS usuarios
         FROM areas a
        WHERE a.activo
        ORDER BY a.nombre`,
    );
    return rows;
  }

  static async actualizarArea(id, { gerenteId, suplenteId, activo }, usuarioId) {
    const gerente = gerenteId || null;
    const suplente = suplenteId || null;
    if (suplente && !gerente) {
      throw new AppError("Primero asigna al gerente; el suplente solo lo cubre", 400);
    }
    if (suplente && suplente === gerente) {
      throw new AppError("El suplente tiene que ser otra persona", 400);
    }
    const { rows } = await db.query(
      `UPDATE compras_areas
          SET gerente_id = $2, suplente_id = $3, activo = coalesce($4, activo),
              actualizado_en = now(), actualizado_por = $5
        WHERE id = $1
        RETURNING id, nombre, gerente_id, suplente_id, activo`,
      [id, gerente, suplente, typeof activo === "boolean" ? activo : null, usuarioId],
    );
    if (!rows[0]) throw new AppError("El área no existe", 404);
    return rows[0];
  }

  static async ligarAreaDbx(areaDbxId, comprasAreaId) {
    const { rows } = await db.query(
      `UPDATE areas SET compras_area_id = $2 WHERE id = $1 RETURNING id, nombre, compras_area_id`,
      [areaDbxId, comprasAreaId || null],
    );
    if (!rows[0]) throw new AppError("El área no existe", 404);
    return rows[0];
  }
}

module.exports = CompraSolicitud;
