const db = require("../config/database");
const { AppError } = require("../utils/errorHandler");
const Catalogo = require("./CompraCatalogo");

/**
 * Formatos de autorización y registro de compras (los de papel).
 *
 * Ver migrations/2026-11-10_compras_solicitudes_07_formatos.sql. Los de papel se
 * capturan aquí; quien firmó va como texto. Las órdenes firmadas en el DBX entran
 * solas al autorizarse (migración 14, orden_id) y no se corrigen ni se borran.
 * Los montos en dólares se pasan a pesos con el FIX de Banxico del día del
 * formato (o el último publicado antes), solo para sumar en el reporte.
 *
 * Tipo y cuenta se escogen de las listas de Compras y Finanzas (CompraCatalogo);
 * se guarda el texto, y lo capturado a mano antes de las listas se respeta.
 */

const SERIE_FIX = "SF43718";

// Las cuatro firmas del formato, en el orden del flujo (13-nov-2026: Dirección al final)
const FIRMAS = [
  { campo: "autorizo_gerente", nombre: "Gerente" },
  { campo: "autorizo_compras", nombre: "Compras" },
  { campo: "autorizo_finanzas", nombre: "Finanzas" },
  { campo: "autorizo_direccion", nombre: "Dirección" },
];

// Campos de texto: nombre en el body → [columna, largo máximo]
const TEXTOS = {
  ticket: ["ticket", 32],
  autorizoGerente: ["autorizo_gerente", 120],
  clasifTipo: ["clasif_tipo", 120],
  autorizoCompras: ["autorizo_compras", 120],
  cuenta: ["cuenta", 60],
  centroCostos: ["centro_costos", 60],
  autorizoFinanzas: ["autorizo_finanzas", 120],
  autorizoDireccion: ["autorizo_direccion", 120],
};

// Quienes firman por Dirección; se sugieren aunque todavía no haya capturas
const DIRECCION = ["Celina", "Stefano"];

const limpio = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

const SELECT = `
  SELECT f.id, f.ticket, to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
         f.compras_area_id, ca.nombre AS area_nombre,
         f.requerimiento, f.monto::float AS monto, f.moneda,
         f.autorizo_gerente, f.clasif_tipo, f.autorizo_compras,
         f.cuenta, cc.nombre AS cuenta_nombre, f.centro_costos, f.autorizo_finanzas, f.autorizo_direccion,
         f.observaciones, f.orden_id,
         f.capturado_por, cu.nombre_completo AS capturado_por_nombre,
         to_char(f.capturado_en, 'YYYY-MM-DD HH24:MI') AS capturado_en,
         au.nombre_completo AS actualizado_por_nombre,
         to_char(f.actualizado_en, 'YYYY-MM-DD HH24:MI') AS actualizado_en,
         tc.valor::float AS tipo_cambio,
         CASE WHEN f.moneda = 'MXN' THEN f.monto::float
              WHEN tc.valor IS NOT NULL THEN round(f.monto * tc.valor, 2)::float END AS monto_mxn
    FROM compras_formatos f
    JOIN compras_areas ca ON ca.id = f.compras_area_id
    LEFT JOIN compras_cuentas cc ON cc.codigo = f.cuenta
    LEFT JOIN usuarios cu ON cu.id = f.capturado_por
    LEFT JOIN usuarios au ON au.id = f.actualizado_por
    -- FIX del día o el último antes; si no hay, el más cercano después
    LEFT JOIN LATERAL (
      SELECT valor FROM tipos_cambio
       WHERE serie = '${SERIE_FIX}' AND f.moneda = 'USD'
       ORDER BY (fecha > f.fecha), abs(fecha - f.fecha) LIMIT 1
    ) tc ON true`;

/** Qué firmas le faltan a un formato. */
function conEstado(f) {
  const faltan = FIRMAS.filter((x) => !f[x.campo]).map((x) => x.nombre);
  return { ...f, faltan, completo: faltan.length === 0 };
}

class CompraFormato {
  static FIRMAS = FIRMAS;

  /**
   * @param {Object} f  desde, hasta (YYYY-MM-DD), areaId, moneda, estado ('completos'|'pendientes'), q
   */
  static async listar(f = {}) {
    const where = [];
    const params = [];
    const p = (v) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (f.desde) where.push(`f.fecha >= ${p(f.desde)}`);
    if (f.hasta) where.push(`f.fecha <= ${p(f.hasta)}`);
    if (f.areaId) where.push(`f.compras_area_id = ${p(f.areaId)}`);
    if (f.moneda) where.push(`f.moneda = ${p(f.moneda)}`);
    const firmas = FIRMAS.map((x) => `nullif(f.${x.campo}, '') IS NOT NULL`).join(" AND ");
    if (f.estado === "completos") where.push(`(${firmas})`);
    if (f.estado === "pendientes") where.push(`NOT (${firmas})`);
    if (f.q) {
      const q = p(`%${f.q}%`);
      where.push(
        `(f.ticket ILIKE ${q} OR f.requerimiento ILIKE ${q} OR f.clasif_tipo ILIKE ${q}
          OR f.cuenta ILIKE ${q} OR cc.nombre ILIKE ${q} OR f.centro_costos ILIKE ${q} OR f.observaciones ILIKE ${q})`,
      );
    }
    const { rows } = await db.query(
      `${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY f.fecha DESC, f.id DESC`,
      params,
    );
    return rows.map(conEstado);
  }

  static async obtener(id) {
    const { rows } = await db.query(`${SELECT} WHERE f.id = $1`, [id]);
    if (!rows[0]) throw new AppError("No existe ese formato", 404);
    return conEstado(rows[0]);
  }

  /** Valida y normaliza lo que viene de la pantalla. */
  static normalizar(body = {}) {
    const d = {};
    for (const [clave, [columna, largo]] of Object.entries(TEXTOS)) {
      const v = limpio(body[clave]);
      if (v && v.length > largo) throw new AppError(`"${clave}" es demasiado largo (máximo ${largo})`, 400);
      d[columna] = v;
    }
    if (d.ticket) d.ticket = d.ticket.toUpperCase();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || ""))) throw new AppError("Falta la fecha del formato", 400);
    d.fecha = body.fecha;

    const areaId = parseInt(body.areaId, 10);
    if (!Number.isInteger(areaId) || areaId <= 0) throw new AppError("Falta el área solicitante", 400);
    d.compras_area_id = areaId;

    d.requerimiento = limpio(body.requerimiento);
    if (!d.requerimiento) throw new AppError("Falta el requerimiento", 400);

    if (body.monto == null || body.monto === "") d.monto = null;
    else {
      const m = Number(body.monto);
      if (!Number.isFinite(m) || m < 0) throw new AppError("El costo no es un monto válido", 400);
      d.monto = Math.round(m * 100) / 100;
    }
    d.moneda = body.moneda === "USD" ? "USD" : "MXN";
    d.observaciones = body.observaciones == null ? null : String(body.observaciones).trim() || null;
    return d;
  }

  static async crear(body, usuarioId) {
    const d = await Catalogo.validarFormato(CompraFormato.normalizar(body));
    const cols = Object.keys(d);
    try {
      const { rows } = await db.query(
        `INSERT INTO compras_formatos (${cols.join(", ")}, capturado_por, actualizado_por)
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}, $${cols.length + 1})
         RETURNING id`,
        [...cols.map((c) => d[c]), usuarioId],
      );
      return CompraFormato.obtener(rows[0].id);
    } catch (e) {
      throw CompraFormato.traducirError(e, d);
    }
  }

  static async actualizar(id, body, usuarioId) {
    const anterior = await CompraFormato.obtener(id);
    if (anterior.orden_id) throw CompraFormato.firmado();
    const d = await Catalogo.validarFormato(CompraFormato.normalizar(body), anterior);
    const cols = Object.keys(d);
    try {
      const { rowCount } = await db.query(
        `UPDATE compras_formatos
            SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")},
                actualizado_por = $${cols.length + 1}, actualizado_en = now()
          WHERE id = $${cols.length + 2}`,
        [...cols.map((c) => d[c]), usuarioId, id],
      );
      if (!rowCount) throw new AppError("No existe ese formato", 404);
      return CompraFormato.obtener(id);
    } catch (e) {
      throw CompraFormato.traducirError(e, d);
    }
  }

  static async eliminar(id) {
    const anterior = await CompraFormato.obtener(id);
    if (anterior.orden_id) throw CompraFormato.firmado();
    const { rows } = await db.query("DELETE FROM compras_formatos WHERE id = $1 RETURNING ticket", [id]);
    if (!rows[0]) throw new AppError("No existe ese formato", 404);
    return rows[0];
  }

  /** Los que vienen de una orden firmada en el DBX no se corrigen ni se borran. */
  static firmado() {
    return new AppError("Este formato viene de una orden de compra firmada en el DBX: lo firmado no se corrige aquí", 409);
  }

  static traducirError(e, d) {
    if (e.code === "23505") return new AppError(`Ya hay un formato capturado con el ticket ${d.ticket}`, 409);
    if (e.code === "23503") return new AppError("El área solicitante no existe", 400);
    return e;
  }

  /**
   * Para la captura: las áreas, las listas de tipos y cuentas, y lo ya escrito
   * en los campos libres (centro de costos, quién firmó) para sugerirlo.
   */
  static async opciones() {
    const { rows: areas } = await db.query(
      "SELECT id, nombre FROM compras_areas WHERE activo ORDER BY nombre",
    );
    const campos = [
      "clasif_tipo", "cuenta", "centro_costos",
      "autorizo_gerente", "autorizo_compras", "autorizo_finanzas", "autorizo_direccion",
    ];
    const { rows } = await db.query(
      campos
        .map(
          (c) => `SELECT '${c}' AS campo, ${c} AS valor, count(*) AS n FROM compras_formatos
                   WHERE nullif(${c}, '') IS NOT NULL GROUP BY ${c}`,
        )
        .join(" UNION ALL ") + " ORDER BY campo, n DESC, valor",
    );
    const sugerencias = Object.fromEntries(campos.map((c) => [c, []]));
    for (const r of rows) sugerencias[r.campo].push(r.valor);
    for (const n of DIRECCION) if (!sugerencias.autorizo_direccion.includes(n)) sugerencias.autorizo_direccion.push(n);
    return { areas, sugerencias, ...(await Catalogo.listar()) };
  }
}

module.exports = CompraFormato;
