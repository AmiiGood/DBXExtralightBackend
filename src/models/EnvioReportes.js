const db = require("../config/database");
const {
  construirCron,
  describirHorario,
} = require("../services/planificador.service");

/**
 * Listas de correo, programaciones de envío y bitácora.
 *
 * Los destinatarios viven solo en las listas: no hay ningún camino para mandar
 * un reporte a un correo escrito a mano.
 */
class EnvioReportes {
  // ------------------------------------------------------------- listas

  static async getListas() {
    const { rows } = await db.query(
      `SELECT l.id, l.nombre, l.descripcion, l.activo, l.creado_en,
              count(m.id) FILTER (WHERE m.activo)::int AS miembros
         FROM listas_correo l
         LEFT JOIN listas_correo_miembros m ON m.lista_id = l.id
        GROUP BY l.id
        ORDER BY l.nombre`,
    );
    return rows;
  }

  static async getLista(id) {
    const { rows } = await db.query(
      `SELECT id, nombre, descripcion, activo FROM listas_correo WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) return null;
    const miembros = await db.query(
      `SELECT id, nombre, correo, activo FROM listas_correo_miembros
        WHERE lista_id = $1 ORDER BY correo`,
      [id],
    );
    return { ...rows[0], miembros: miembros.rows };
  }

  static async crearLista({ nombre, descripcion }, usuarioId) {
    const { rows } = await db.query(
      `INSERT INTO listas_correo (nombre, descripcion, creado_por)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, descripcion || null, usuarioId],
    );
    return rows[0];
  }

  static async actualizarLista(id, { nombre, descripcion, activo }) {
    const { rows } = await db.query(
      `UPDATE listas_correo
          SET nombre = COALESCE($2, nombre),
              descripcion = COALESCE($3, descripcion),
              activo = COALESCE($4, activo)
        WHERE id = $1 RETURNING *`,
      [id, nombre ?? null, descripcion ?? null, activo ?? null],
    );
    return rows[0] || null;
  }

  static async eliminarLista(id) {
    // Si alguna programación la usa, se bloquea: borrarla dejaría envíos huérfanos
    const { rows } = await db.query(
      `SELECT count(*)::int c FROM reportes_programados WHERE lista_id = $1`,
      [id],
    );
    if (rows[0].c > 0) {
      const e = new Error(
        `La lista está en uso por ${rows[0].c} programación(es). Desactívala o cámbialas primero.`,
      );
      e.statusCode = 409;
      throw e;
    }
    const r = await db.query(`DELETE FROM listas_correo WHERE id = $1`, [id]);
    return r.rowCount > 0;
  }

  // ----------------------------------------------------------- miembros

  static async agregarMiembro(listaId, { nombre, correo }) {
    const { rows } = await db.query(
      `INSERT INTO listas_correo_miembros (lista_id, nombre, correo)
       VALUES ($1, $2, $3)
       ON CONFLICT (lista_id, lower(correo)) DO UPDATE
         SET nombre = EXCLUDED.nombre, activo = true
       RETURNING *`,
      [listaId, nombre || null, correo.trim()],
    );
    return rows[0];
  }

  static async actualizarMiembro(id, { nombre, activo }) {
    const { rows } = await db.query(
      `UPDATE listas_correo_miembros
          SET nombre = COALESCE($2, nombre), activo = COALESCE($3, activo)
        WHERE id = $1 RETURNING *`,
      [id, nombre ?? null, activo ?? null],
    );
    return rows[0] || null;
  }

  static async eliminarMiembro(id) {
    const r = await db.query(
      `DELETE FROM listas_correo_miembros WHERE id = $1`,
      [id],
    );
    return r.rowCount > 0;
  }

  // ----------------------------------------------------- programaciones

  static async getProgramaciones() {
    const { rows } = await db.query(
      `SELECT p.*, l.nombre AS lista_nombre,
              count(m.id) FILTER (WHERE m.activo)::int AS destinatarios,
              (SELECT creado_en FROM reportes_envios e
                WHERE e.programado_id = p.id ORDER BY e.id DESC LIMIT 1) AS ultimo_envio,
              (SELECT estado FROM reportes_envios e
                WHERE e.programado_id = p.id ORDER BY e.id DESC LIMIT 1) AS ultimo_estado
         FROM reportes_programados p
         JOIN listas_correo l ON l.id = p.lista_id
         LEFT JOIN listas_correo_miembros m ON m.lista_id = l.id
        GROUP BY p.id, l.nombre
        ORDER BY p.nombre`,
    );
    return rows.map((r) => ({ ...r, horario: describirHorario(r) }));
  }

  static async getProgramacion(id) {
    const { rows } = await db.query(
      `SELECT p.*, l.nombre AS lista_nombre
         FROM reportes_programados p
         JOIN listas_correo l ON l.id = p.lista_id
        WHERE p.id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  static async crearProgramacion(datos, usuarioId) {
    const cron = construirCron(datos);
    const { rows } = await db.query(
      `INSERT INTO reportes_programados
         (nombre, formato, periodo_relativo, filtros, frecuencia, dia, hora,
          minuto, zona_horaria, expresion_cron, lista_id, asunto, mensaje,
          activo, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        datos.nombre,
        datos.formato || "PDF",
        datos.periodoRelativo || "SEMANA_ANTERIOR",
        JSON.stringify(datos.filtros || {}),
        datos.frecuencia || "SEMANAL",
        datos.frecuencia === "DIARIA" ? null : datos.dia,
        datos.hora ?? 8,
        datos.minuto ?? 0,
        datos.zonaHoraria || "America/Mexico_City",
        cron,
        datos.listaId,
        datos.asunto || null,
        datos.mensaje || null,
        datos.activo ?? true,
        usuarioId,
      ],
    );
    return rows[0];
  }

  static async actualizarProgramacion(id, datos) {
    const actual = await this.getProgramacion(id);
    if (!actual) return null;

    const fusion = {
      frecuencia: datos.frecuencia ?? actual.frecuencia,
      dia: datos.dia ?? actual.dia,
      hora: datos.hora ?? actual.hora,
      minuto: datos.minuto ?? actual.minuto,
    };
    if (fusion.frecuencia === "DIARIA") fusion.dia = null;

    const { rows } = await db.query(
      `UPDATE reportes_programados
          SET nombre = COALESCE($2, nombre),
              formato = COALESCE($3, formato),
              periodo_relativo = COALESCE($4, periodo_relativo),
              filtros = COALESCE($5, filtros),
              frecuencia = $6, dia = $7, hora = $8, minuto = $9,
              zona_horaria = COALESCE($10, zona_horaria),
              expresion_cron = $11,
              lista_id = COALESCE($12, lista_id),
              asunto = COALESCE($13, asunto),
              mensaje = COALESCE($14, mensaje),
              activo = COALESCE($15, activo),
              actualizado_en = now()
        WHERE id = $1 RETURNING *`,
      [
        id,
        datos.nombre ?? null,
        datos.formato ?? null,
        datos.periodoRelativo ?? null,
        datos.filtros ? JSON.stringify(datos.filtros) : null,
        fusion.frecuencia,
        fusion.dia,
        fusion.hora,
        fusion.minuto,
        datos.zonaHoraria ?? null,
        construirCron(fusion),
        datos.listaId ?? null,
        datos.asunto ?? null,
        datos.mensaje ?? null,
        datos.activo ?? null,
      ],
    );
    return rows[0];
  }

  static async eliminarProgramacion(id) {
    const r = await db.query(
      `DELETE FROM reportes_programados WHERE id = $1`,
      [id],
    );
    return r.rowCount > 0;
  }

  // ----------------------------------------------------------- bitácora

  static async getEnvios({ programadoId, limite = 50 } = {}) {
    const valores = [];
    let filtro = "";
    if (programadoId) {
      valores.push(programadoId);
      filtro = `WHERE e.programado_id = $1`;
    }
    valores.push(limite);

    const { rows } = await db.query(
      `SELECT e.*, p.nombre AS programacion, u.nombre_completo AS usuario
         FROM reportes_envios e
         LEFT JOIN reportes_programados p ON p.id = e.programado_id
         LEFT JOIN usuarios u ON u.id = e.enviado_por
         ${filtro}
        ORDER BY e.id DESC
        LIMIT $${valores.length}`,
      valores,
    );
    return rows;
  }
}

module.exports = EnvioReportes;
