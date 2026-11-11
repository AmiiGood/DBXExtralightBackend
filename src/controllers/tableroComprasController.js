const Tablero = require("../models/CompraTablero");
const { catchAsync, sendSuccess, AppError } = require("../utils/errorHandler");

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/compras/tablero?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (por omisión, el año en curso) */
const getTablero = catchAsync(async (req, res) => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const desde = FECHA.test(req.query.desde || "") ? req.query.desde : `${hoy.slice(0, 4)}-01-01`;
  const hasta = FECHA.test(req.query.hasta || "") ? req.query.hasta : hoy;
  if (desde > hasta) throw new AppError("La fecha inicial es posterior a la final", 400);
  sendSuccess(res, 200, await Tablero.datos(desde, hasta));
});

module.exports = { getTablero };
