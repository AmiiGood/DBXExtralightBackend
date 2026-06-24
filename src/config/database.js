const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20, // Máximo de conexiones en el pool
  min: 2,
  idleTimeoutMillis: 60000, // Tiempo de espera antes de cerrar una conexión inactiva
  connectionTimeoutMillis: 5000, // Tiempo de espera para obtener una conexión
  allowExitOnIdle: false,
});

let isFirstConnection = true;
pool.on("connect", () => {
  if (isFirstConnection) {
    console.log("✅ Pool de PostgreSQL inicializado");
    isFirstConnection = false;
  }
});

pool.on("error", (err) => {
  console.error("❌ Error en el pool de PostgreSQL:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
