const db = require("../config/database");

/**
 * Captura de producción de inyección.
 *
 * La unidad de captura es el TURNO de una máquina en un día: el capturista
 * elige fecha + máquina + turno y llena un renglón por estación. Una estación
 * puede llevar más de un renglón si corrió varios SKU en el mismo turno.
 *
 * Nada se calcula aquí que la BD ya calcule: `ciclos` y `produccion_teorica`
 * son columnas generadas. `produccion` sí se guarda porque admite override
 * manual (días sin lectura de contadores).
 */
class InyeccionCaptura {
  /**
   * Catálogos del formulario: máquinas activas con sus estaciones y los turnos.
   */
  static async getCatalogos() {
    const [maquinas, estaciones, turnos] = await Promise.all([
      db.query(
        `SELECT m.id, m.codigo, u.nombre AS unidad_negocio
           FROM iny_maquinas m
           LEFT JOIN unidades_negocio u ON u.id = m.unidad_negocio_id
          WHERE m.activo = true
          ORDER BY m.orden, m.codigo`,
      ),
      db.query(
        `SELECT id, maquina_id, codigo, cavidades_default
           FROM iny_estaciones
          WHERE activo = true
          ORDER BY maquina_id, orden, codigo`,
      ),
      db.query(
        `SELECT id, nombre, hora_inicio, hora_fin
           FROM turnos WHERE activo = true ORDER BY hora_inicio`,
      ),
    ]);

    // Se anidan las estaciones en su máquina para que el front no tenga que cruzar
    const porMaquina = new Map();
    for (const e of estaciones.rows) {
      if (!porMaquina.has(e.maquina_id)) porMaquina.set(e.maquina_id, []);
      porMaquina.get(e.maquina_id).push({
        id: e.id,
        codigo: e.codigo,
        cavidadesDefault: e.cavidades_default,
      });
    }

    return {
      maquinas: maquinas.rows.map((m) => ({
        ...m,
        estaciones: porMaquina.get(m.id) || [],
      })),
      turnos: turnos.rows,
    };
  }

  /**
   * Autocompletar de producto semiterminado por SKU o descripción.
   */
  static async buscarProductos(texto, bu, limite = 30) {
    const t = `%${String(texto || "").trim().toLowerCase()}%`;
    const values = [t];
    let filtroBu = "";
    if (bu) {
      values.push(bu);
      filtroBu = `AND bu_reporte = $${values.length}`;
    }
    values.push(limite);

    const { rows } = await db.query(
      `SELECT id, sku, descripcion, color_codigo, variante, talla, bu_reporte
         FROM iny_productos
        WHERE activo = true
          AND (lower(sku) LIKE $1 OR lower(descripcion) LIKE $1)
          ${filtroBu}
        ORDER BY sku
        LIMIT $${values.length}`,
      values,
    );
    return rows;
  }

  /**
   * Lo capturado para una fecha + máquina + turno. Si no hay nada devuelve
   * la lista vacía; el formulario arma la grilla con las estaciones activas.
   */
  static async getCaptura(fecha, maquinaId, turnoId) {
    const { rows } = await db.query(
      `SELECT p.id, p.estacion_id, e.codigo AS estacion, p.producto_id,
              pr.sku, pr.descripcion, p.cavidades, p.contador_inicial,
              p.contador_final, p.ciclos, p.produccion_teorica, p.produccion,
              p.scrap, p.observaciones, p.origen, p.editado,
              u.nombre_completo AS registrado_por
         FROM iny_produccion p
         LEFT JOIN iny_estaciones e  ON e.id  = p.estacion_id
         LEFT JOIN iny_productos  pr ON pr.id = p.producto_id
         LEFT JOIN usuarios       u  ON u.id  = p.registrado_por
        WHERE p.tipo = 'PRODUCCION'
          AND p.fecha = $1 AND p.maquina_id = $2 AND p.turno_id = $3
        ORDER BY e.orden NULLS LAST, e.codigo, p.id`,
      [fecha, maquinaId, turnoId],
    );
    return rows;
  }

  /**
   * Guarda el turno completo en una transacción.
   *
   * @param {Object} datos { fecha, maquinaId, turnoId, renglones[], eliminados[] }
   * @param {Number} usuarioId
   * @returns {Object} conteos de lo que pasó
   *
   * Los renglones con `id` se actualizan; los que no, se insertan. Los ids
   * listados en `eliminados` se borran. Nunca se borra nada que el usuario no
   * haya quitado explícitamente de la grilla.
   */
  static async guardar(datos, usuarioId) {
    const { fecha, maquinaId, turnoId, renglones = [], eliminados = [] } = datos;
    const cliente = await db.pool.connect();

    try {
      await cliente.query("BEGIN");

      // La BU y el modelo viajan con el producto: se resuelven en el servidor
      // para que el front no pueda mandar una clasificación inventada.
      const idsProducto = [
        ...new Set(renglones.map((r) => r.productoId).filter(Boolean)),
      ];
      const productos = new Map();
      if (idsProducto.length > 0) {
        const { rows } = await cliente.query(
          `SELECT id, modelo_id, bu_reporte FROM iny_productos WHERE id = ANY($1)`,
          [idsProducto],
        );
        for (const p of rows) productos.set(p.id, p);
      }

      let insertados = 0;
      let actualizados = 0;
      let omitidos = 0;

      for (const r of renglones) {
        // Un renglón sin números no es una captura, aunque traiga producto:
        // el botón "aplicar a todos" del formulario le pone SKU a las 16
        // estaciones y solo algunas corrieron de verdad. Los renglones ya
        // guardados sí se respetan: si el usuario los vació es porque quiere
        // ponerlos en cero, y para borrarlos existe `eliminados`.
        const sinNumeros =
          !Number(r.produccion) &&
          !Number(r.scrap) &&
          r.contadorInicial == null &&
          r.contadorFinal == null;
        if (sinNumeros && !r.id) {
          omitidos++;
          continue;
        }

        const p = r.productoId ? productos.get(r.productoId) : null;

        if (r.id) {
          const { rowCount } = await cliente.query(
            `UPDATE iny_produccion
                SET estacion_id = $1, producto_id = $2, modelo_id = $3,
                    bu_reporte = $4, cavidades = $5, contador_inicial = $6,
                    contador_final = $7, produccion = $8, scrap = $9,
                    observaciones = $10, editado = true, editado_en = now(),
                    editado_por = $11, actualizado_en = now()
              WHERE id = $12 AND tipo = 'PRODUCCION'`,
            [
              r.estacionId ?? null,
              r.productoId ?? null,
              p?.modelo_id ?? null,
              p?.bu_reporte ?? null,
              r.cavidades ?? 0,
              r.contadorInicial ?? null,
              r.contadorFinal ?? null,
              r.produccion ?? 0,
              r.scrap ?? 0,
              r.observaciones || null,
              usuarioId,
              r.id,
            ],
          );
          if (rowCount > 0) actualizados++;
        } else {
          await cliente.query(
            `INSERT INTO iny_produccion
               (tipo, fecha, turno_id, maquina_id, estacion_id, producto_id,
                modelo_id, bu_reporte, cavidades, contador_inicial,
                contador_final, produccion, scrap, observaciones, origen,
                registrado_por)
             VALUES ('PRODUCCION', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                     $11, $12, $13, 'FORMULARIO', $14)`,
            [
              fecha,
              turnoId,
              maquinaId,
              r.estacionId ?? null,
              r.productoId ?? null,
              p?.modelo_id ?? null,
              p?.bu_reporte ?? null,
              r.cavidades ?? 0,
              r.contadorInicial ?? null,
              r.contadorFinal ?? null,
              r.produccion ?? 0,
              r.scrap ?? 0,
              r.observaciones || null,
              usuarioId,
            ],
          );
          insertados++;
        }
      }

      let eliminadosCount = 0;
      if (eliminados.length > 0) {
        const { rowCount } = await cliente.query(
          `DELETE FROM iny_produccion
            WHERE id = ANY($1) AND fecha = $2 AND maquina_id = $3
              AND turno_id = $4 AND tipo = 'PRODUCCION'`,
          [eliminados, fecha, maquinaId, turnoId],
        );
        eliminadosCount = rowCount;
      }

      await cliente.query("COMMIT");
      return { insertados, actualizados, eliminados: eliminadosCount, omitidos };
    } catch (error) {
      await cliente.query("ROLLBACK");
      throw error;
    } finally {
      cliente.release();
    }
  }

  /**
   * Resumen del día para el encabezado del formulario: qué turnos de qué
   * máquinas ya tienen captura.
   */
  static async getAvanceDelDia(fecha) {
    const { rows } = await db.query(
      `SELECT m.codigo AS maquina, t.nombre AS turno,
              count(*)::int AS renglones,
              sum(p.produccion)::float AS produccion,
              sum(p.scrap)::float AS scrap
         FROM iny_produccion p
         JOIN iny_maquinas m ON m.id = p.maquina_id
         JOIN turnos       t ON t.id = p.turno_id
        WHERE p.fecha = $1 AND p.tipo = 'PRODUCCION'
        GROUP BY m.codigo, t.nombre, m.orden
        ORDER BY m.orden, t.nombre`,
      [fecha],
    );
    return rows;
  }
}

module.exports = InyeccionCaptura;
