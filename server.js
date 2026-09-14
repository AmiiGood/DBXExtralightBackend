require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const db = require("./src/config/database");
const planificador = require("./src/services/planificador.service");
const moldes = require("./src/services/sincronizarMoldes.service");

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

    // Réplica de los tickets de Moldes. El reporte lee la copia local, así que
    // el servidor de osTicket no recibe carga de las consultas del tablero.
    moldes.iniciarProgramado();

    const gracefulShutdown = (signal) => {
      console.log(`\n⚠️  Recibida señal ${signal}. Cerrando servidor...`);
      planificador.detenerTodas();
      moldes.detenerProgramado();
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
