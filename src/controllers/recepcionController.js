const db = require("../config/database");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");

// Parsear QR de caja: "46400689$206991-100-J5$24$004"
// El escáner puede mandar comillas simples en lugar de guiones: "14012026$207013'410'J3$24$020"
function parsearQrCaja(raw) {
  const parts = raw.trim().split("$");
  if (parts.length < 4) return null;
  const pares = parseInt(parts[2], 10);
  if (isNaN(pares) || pares <= 0) return null;
  return {
    boxId: parts[0],
    sku: parts[1].replace(/'/g, "-").toUpperCase(),
    paresEsperados: pares,
    consecutivo: parts[3],
  };
}

// Escanear caja: crea o retoma
const escanearCaja = catchAsync(async (req, res, next) => {
  const { qrRaw } = req.body;
  if (!qrRaw) return next(new AppError("qrRaw es requerido", 400));

  const parsed = parsearQrCaja(qrRaw);
  if (!parsed)
    return next(new AppError("Formato inválido. Esperado: ID$SKU$PARES$CONSECUTIVO", 400));

  // Buscar si ya existe esta caja
  const existe = await db.query(
    `SELECT c.*, 
            COALESCE(json_agg(p.* ORDER BY p.creado_en DESC) FILTER (WHERE p.id IS NOT NULL), '[]') as pares
     FROM recepcion_cajas c
     LEFT JOIN recepcion_pares p ON p.caja_id = c.id
     WHERE c.box_id = $1 AND c.consecutivo = $2
     GROUP BY c.id`,
    [parsed.boxId, parsed.consecutivo]
  );

  if (existe.rows.length) {
    const caja = existe.rows[0];
    return sendSuccess(res, 200, { caja, retomada: true },
      caja.completa ? "Caja ya completada" : `Caja retomada: ${caja.pares_escaneados}/${caja.pares_esperados} pares escaneados`
    );
  }

  // Crear nueva caja
  const { rows } = await db.query(
    `INSERT INTO recepcion_cajas (qr_raw, box_id, sku, pares_esperados, consecutivo, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [qrRaw.trim(), parsed.boxId, parsed.sku, parsed.paresEsperados, parsed.consecutivo, req.usuario.id]
  );

  sendSuccess(res, 201, { caja: { ...rows[0], pares: [] }, retomada: false }, "Caja registrada");
});

// Escanear par
const escanearPar = catchAsync(async (req, res, next) => {
  const { cajaId } = req.params;
  const { qrRaw } = req.body;

  if (!qrRaw) return next(new AppError("qrRaw es requerido", 400));

  const cajaRes = await db.query(`SELECT * FROM recepcion_cajas WHERE id = $1`, [cajaId]);
  if (!cajaRes.rows.length) return next(new AppError("Caja no encontrada", 404));
  const caja = cajaRes.rows[0];

  if (caja.completa) return next(new AppError("La caja ya está completa", 400));


  // El escáner lee el UPC directo del par (solo números)
  const upc = qrRaw.trim();

  // Validar que el UPC exista en productos_crocs con el SKU de la caja
  const validacion = await db.query(
    `SELECT id FROM productos_crocs WHERE UPPER(sku) = UPPER($1) AND upc = $2 AND activo = true LIMIT 1`,
    [caja.sku, upc]
  );
  if (!validacion.rows.length) {
    const info = await db.query(
      `SELECT sku, style_name FROM productos_crocs WHERE upc = $1 AND activo = true LIMIT 1`,
      [upc]
    );
    const detalle = info.rows.length
      ? ` (UPC pertenece a SKU: ${info.rows[0].sku} — ${info.rows[0].style_name || ""})`
      : ` (UPC ${upc} no existe en el catálogo)`;
    return next(new AppError(`Par incorrecto: UPC no coincide con SKU ${caja.sku}${detalle}`, 422));
  }

  await db.query(
    `INSERT INTO recepcion_pares (caja_id, qr_raw, upc, escaneado_por) VALUES ($1, $2, $3, $4)`,
    [cajaId, qrRaw.trim(), upc, req.usuario.id]
  );

  const nuevosEscaneados = caja.pares_escaneados + 1;
  const completa = nuevosEscaneados >= caja.pares_esperados;

  const { rows } = await db.query(
    `UPDATE recepcion_cajas SET pares_escaneados = $1, completa = $2 WHERE id = $3 RETURNING *`,
    [nuevosEscaneados, completa, cajaId]
  );

  sendSuccess(res, 200, {
    caja: rows[0],
    parEscaneado: nuevosEscaneados,
    completa,
    faltantes: Math.max(0, caja.pares_esperados - nuevosEscaneados),
    upc,
  }, completa ? "¡Caja completa!" : `Par ${nuevosEscaneados} de ${caja.pares_esperados}`);
});

// Obtener pares de una caja
const getPares = catchAsync(async (req, res) => {
  const { cajaId } = req.params;
  const { rows } = await db.query(
    `SELECT p.*, u.nombre_completo as escaneado_por_nombre
     FROM recepcion_pares p
     LEFT JOIN usuarios u ON p.escaneado_por = u.id
     WHERE p.caja_id = $1 ORDER BY p.creado_en DESC`,
    [cajaId]
  );
  sendSuccess(res, 200, { pares: rows });
});

// Reporte
const getReporte = catchAsync(async (req, res) => {
  const { fechaInicio, fechaFin, sku, completa } = req.query;

  let where = "1=1";
  const params = [];

  if (fechaInicio) { params.push(fechaInicio); where += ` AND c.creado_en >= $${params.length}`; }
  if (fechaFin) { params.push(fechaFin); where += ` AND c.creado_en <= $${params.length}`; }
  if (sku) { params.push(`%${sku}%`); where += ` AND c.sku ILIKE $${params.length}`; }
  if (completa !== undefined && completa !== "") {
    params.push(completa === "true");
    where += ` AND c.completa = $${params.length}`;
  }

  const { rows: cajas } = await db.query(
    `SELECT c.*, u.nombre_completo as creado_por_nombre
     FROM recepcion_cajas c
     LEFT JOIN usuarios u ON c.creado_por = u.id
     WHERE ${where}
     ORDER BY c.creado_en DESC`,
    params
  );

  const resumen = {
    totalCajas: cajas.length,
    cajasCompletas: cajas.filter((c) => c.completa).length,
    cajasPendientes: cajas.filter((c) => !c.completa).length,
    totalParesEsperados: cajas.reduce((a, c) => a + (parseInt(c.pares_esperados) || 0), 0),
    totalParesEscaneados: cajas.reduce((a, c) => a + (parseInt(c.pares_escaneados) || 0), 0),
  };

  sendSuccess(res, 200, { resumen, cajas });
});

// Export Excel — kept for backwards compat but frontend now handles it
const exportExcel = catchAsync(async (req, res) => {
  const XLSX = require("xlsx");
  const { fechaInicio, fechaFin, sku, completa } = req.query;

  let where = "1=1";
  const params = [];
  if (fechaInicio) { params.push(fechaInicio); where += ` AND c.creado_en >= ${params.length}`; }
  if (fechaFin)    { params.push(fechaFin);    where += ` AND c.creado_en <= ${params.length}`; }
  if (sku)         { params.push(`%${sku}%`);  where += ` AND c.sku ILIKE ${params.length}`; }
  if (completa !== undefined && completa !== "") {
    params.push(completa === "true");
    where += ` AND c.completa = ${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT c.consecutivo, c.sku, c.pares_esperados, c.pares_escaneados,
            CASE WHEN c.completa THEN 'Completa' ELSE 'Pendiente' END as estado,
            c.creado_en, u.nombre_completo as usuario
     FROM recepcion_cajas c
     LEFT JOIN usuarios u ON c.creado_por = u.id
     WHERE ${where} ORDER BY c.creado_en DESC`,
    params
  );

  const data = rows.map(r => ({
    Consecutivo:      r.consecutivo,
    SKU:              r.sku,
    "Pares Esperados": r.pares_esperados,
    "Pares Escaneados": r.pares_escaneados,
    Estado:           r.estado,
    Fecha:            new Date(r.creado_en).toLocaleString("es-MX"),
    Usuario:          r.usuario,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);

  // Ancho de columnas
  ws["!cols"] = [12, 22, 16, 17, 12, 22, 20].map(w => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, "Recepción");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Disposition", `attachment; filename="recepcion_${Date.now()}.xlsx"`);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buf);
});

// Export PDF (abre HTML en nueva pestaña, el usuario usa Ctrl+P)
const exportPDF = catchAsync(async (req, res) => {
  const { fechaInicio, fechaFin, sku, completa } = req.query;

  let where = "1=1";
  const params = [];
  if (fechaInicio) { params.push(fechaInicio); where += ` AND c.creado_en >= ${params.length}`; }
  if (fechaFin)    { params.push(fechaFin);    where += ` AND c.creado_en <= ${params.length}`; }
  if (sku)         { params.push(`%${sku}%`);  where += ` AND c.sku ILIKE ${params.length}`; }
  if (completa !== undefined && completa !== "") {
    params.push(completa === "true");
    where += ` AND c.completa = ${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT c.consecutivo, c.sku, c.pares_esperados, c.pares_escaneados,
            CASE WHEN c.completa THEN 'Completa' ELSE 'Pendiente' END as estado,
            c.creado_en, u.nombre_completo as usuario
     FROM recepcion_cajas c
     LEFT JOIN usuarios u ON c.creado_por = u.id
     WHERE ${where} ORDER BY c.creado_en DESC`,
    params
  );

  const totalEsperados  = rows.reduce((a, r) => a + parseInt(r.pares_esperados), 0);
  const totalEscaneados = rows.reduce((a, r) => a + parseInt(r.pares_escaneados), 0);
  const completas       = rows.filter(r => r.estado === "Completa").length;
  const fecha           = new Date().toLocaleString("es-MX");

  const filas = rows.map(r => `
    <tr>
      <td>${r.consecutivo}</td>
      <td>${r.sku}</td>
      <td style="text-align:center">${r.pares_esperados}</td>
      <td style="text-align:center">${r.pares_escaneados}</td>
      <td style="text-align:center">
        <span style="color:${r.estado === 'Completa' ? '#16a34a' : '#ca8a04'}; font-weight:600">${r.estado}</span>
      </td>
      <td>${new Date(r.creado_en).toLocaleString("es-MX")}</td>
      <td>${r.usuario || "—"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 30px; color: #111; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  .sub { color: #555; font-size: 11px; margin-bottom: 20px; }
  .resumen { display: flex; gap: 24px; margin-bottom: 20px; }
  .card { background: #f3f4f6; border-radius: 8px; padding: 10px 18px; }
  .card p { margin: 0; font-size: 10px; color: #555; text-transform: uppercase; }
  .card b { font-size: 20px; }
  table { width: 100%; border-collapse: collapse; }
  thead { background: #1e3a5f; color: white; }
  th { padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) { background: #f9fafb; }
</style>
</head>
<body>
  <h1>Reporte de Recepción de Cajas</h1>
  <div class="sub">Generado: ${fecha}</div>
  <div class="resumen">
    <div class="card"><p>Total Cajas</p><b>${rows.length}</b></div>
    <div class="card"><p>Completas</p><b style="color:#16a34a">${completas}</b></div>
    <div class="card"><p>Pendientes</p><b style="color:#ca8a04">${rows.length - completas}</b></div>
    <div class="card"><p>Pares Esperados</p><b>${totalEsperados}</b></div>
    <div class="card"><p>Pares Escaneados</p><b>${totalEscaneados}</b></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Consecutivo</th><th>SKU</th><th>Esperados</th><th>Escaneados</th><th>Estado</th><th>Fecha</th><th>Usuario</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="recepcion_${Date.now()}.html"`);
  res.send(html);
});

module.exports = { escanearCaja, escanearPar, getPares, getReporte, exportExcel, exportPDF };
