require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const db = require("./src/config/database");

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

    const gracefulShutdown = (signal) => {
      console.log(`\n⚠️  Recibida señal ${signal}. Cerrando servidor...`);
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
