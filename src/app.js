const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const https = require("https");
const fs = require("fs");
const { errorHandler, notFound } = require("./middlewares/errorMiddleware");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: "*",
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.get("/", (req, res) => {
  res.json({
    status: "success",
    message: "API de Foam Creations",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "success",
    message: "Server is running",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/usuarios", require("./routes/usuarioRoutes"));
app.use("/api/defectos", require("./routes/defectoRoutes"));
app.use("/api/logs", require("./routes/logRoutes"));
app.use("/api/catalogos", require("./routes/catalogoRoutes"));
app.use("/api/permisos", require("./routes/permisoRoutes"));
app.use("/api/qr", require("./routes/qrRoutes"));
app.use("/api/shipping", require("./routes/shippingRoutes"));
app.use("/api/produccion", require("./routes/produccionRoutes"));
app.use("/api/recepcion", require("./routes/recepcionRoutes"));
app.use("/api/articulos-massive", require("./routes/articuloMassiveRoutes"));
app.use("/api/inyeccion", require("./routes/inyeccionRoutes"));
app.use("/api/envio-reportes", require("./routes/envioReportesRoutes"));
app.use("/api/moldes", require("./routes/moldesRoutes"));
app.use("/api/compound", require("./routes/compoundRoutes"));
app.use("/api/staff", require("./routes/staffRoutes"));
app.use("/api/resultados", require("./routes/resultadosRoutes"));

app.use(notFound);
app.use(errorHandler);

module.exports = app;