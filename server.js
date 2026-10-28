require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const db = require("./src/config/database");
const planificador = require("./src/services/planificador.service");
const moldes = require("./src/services/sincronizarMoldes.service");
const ti = require("./src/services/sincronizarTi.service");
const customerService = require("./src/services/sincronizarCustomerService.service");
const sharePoint = require("./src/services/sincronizarSharePoint.service");
const capex = require("./src/services/sincronizarCapex.service");
const aims = require("./src/services/sincronizarAims.service");
const comprasEnvio = require("./src/services/enviarCompras.service");
const comprasAvisos = require("./src/services/avisosCompras.service");
const tipoCambio = require("./src/services/tipoCambio.service");

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await db.query("SELECT NOW()");
    console.log("✅ Conexión a PostgreSQL establecida correctamente");

    const server = http.createServer(app).listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
      console.log(`📍 Entorno: ${process.env.NODE_ENV || "development"}`);
      console.log(`🔗 URL: http://localhost:${PORT}`);
      console.log(`💚 Health check: http://localhost:${PORT}/health`);
    });

    // Reportes programados por correo. Si falla no debe impedir que el
    // servidor arranque: la aplicación sirve igual sin envíos automáticos.
    planificador
      .recargar()
      .catch((err) =>
        console.error("⚠️  No se pudo iniciar el planificador:", err.message),
      );

    // Réplicas de los tickets de osTicket. Los reportes leen la copia local,
    // así que el servidor de la mesa de ayuda no recibe carga de las consultas
    // de los tableros.
    moldes.iniciarProgramado();
    ti.iniciarProgramado();

    // Solicitudes de Compra aprobadas que no alcanzaron a llegar al osTicket
    // de Compras (servidor caído, red). Se reintentan solas.
    comprasEnvio.iniciarProgramado();

    // Recordatorios a gerentes con solicitudes pendientes (L–V 9:00 y 16:00
    // por omisión; se cambia en Aprobadores de Compras)
    comprasAvisos.iniciarProgramado();

    // Customer Service no replica una base: vigila dos archivos en una
    // carpeta de red y los relee cuando cambian. Si el servidor no alcanza
    // el recurso compartido, lo anota y sigue: no tumba el arranque.
    customerService.iniciarProgramado();

    // Compound e Inyección: sus libros viven en SharePoint. Se consultan por
    // Microsoft Graph y, si cambiaron, se pasan al mismo importador de la
    // pantalla de carga. Sin credenciales en el .env simplemente no se programa.
    sharePoint.iniciarProgramado();

    // CAPEX: igual que Customer Service, pero el nombre del libro cambia con
    // cada revisión y se toma la Rev más alta de la carpeta.
    capex.iniciarProgramado();

    // AIMS: igual que CAPEX, la rev más alta del libro de indicadores. Nace
    // apagado hasta que se configure la carpeta en "Archivo de AIMS".
    aims.iniciarProgramado();

    // Tipo de cambio FIX de Banxico para los reportes en dólares (Gasto Q4).
    // Sin BANXICO_TOKEN no se programa y la vista en dólares se apaga.
    tipoCambio.iniciarProgramado();

    const gracefulShutdown = (signal) => {
      console.log(`\n⚠️  Recibida señal ${signal}. Cerrando servidor...`);
      planificador.detenerTodas();
      moldes.detenerProgramado();
      ti.detenerProgramado();
      customerService.detenerProgramado();
      sharePoint.detenerProgramado();
      capex.detenerProgramado();
      aims.detenerProgramado();
      tipoCambio.detenerProgramado();
      server.close(() => {
        console.log("✅ Servidor cerrado correctamente");
        db.pool.end(() => {
          console.log("✅ Pool de base de datos cerrado");
          process.exit(0);
        });
      });

      setTimeout(() => {
        console.error("❌ No se pudo cerrar correctamente, forzando salida");
        process.exit(1);
      }, 10000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    process.on("unhandledRejection", (err) => {
      console.error("❌ UNHANDLED REJECTION! 💥 Cerrando servidor...");
      console.error(err.name, err.message);
      server.close(() => process.exit(1));
    });

    process.on("uncaughtException", (err) => {
      console.error("❌ UNCAUGHT EXCEPTION! 💥 Cerrando servidor...");
      console.error(err.name, err.message);
      process.exit(1);
    });
  } catch (error) {
    console.error("❌ Error al conectar a la base de datos:", error);
    process.exit(1);
  }
};

startServer();
