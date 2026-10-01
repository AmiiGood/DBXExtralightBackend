const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Hora de planta en cada conexión: las columnas son TIMESTAMP sin zona con
  // DEFAULT CURRENT_TIMESTAMP, y con la TimeZone del servidor (GMT) se guardaban
  // 6 h adelantadas — el turno B de las 18:00 en adelante caía en el día siguiente.
  options: "-c timezone=America/Mexico_City",
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
