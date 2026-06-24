const db = require("../config/database");

class Turno {
  /**
   * Obtener todos los turnos
   */
  static async findAll(filters = {}) {
    let query = `
      SELECT 
        id,
        nombre,
        hora_inicio,
        hora_fin,
        descripcion,
        activo
      FROM turnos
      WHERE 1=1
    `;

    const values = [];
    let paramCount = 1;

    if (filters.activo !== undefined) {
      query += ` AND activo = $${paramCount}`;
      values.push(filters.activo);
      paramCount++;
    }

    query += " ORDER BY hora_inicio ASC";

    const result = await db.query(query, values);
    return result.rows;
  }

  /**
   * Buscar turno por ID
   */
  static async findById(id) {
    const query = `
      SELECT 
        id,
        nombre,
        hora_inicio,
        hora_fin,
        descripcion,
        activo
      FROM turnos
      WHERE id = $1
    `;

    const result = await db.query(query, [id]);
    return result.rows[0];
  }

  /**
   * Obtener turno actual basado en la hora
   * Usa la función de PostgreSQL obtener_turno_actual()
   */
  static async getCurrentShift() {
    const query = `SELECT obtener_turno_actual() as turno_id`;
    const result = await db.query(query);
    return result.rows[0]?.turno_id;
  }

  /**
   * Obtener información del turno actual
   */
  static async getCurrentShiftInfo() {
    const turnoId = await this.getCurrentShift();
    if (!turnoId) return null;

    return await this.findById(turnoId);
  }
}

module.exports = Turno;
