const mysql = require("mysql2/promise");

/**
 * Conexión a la base de osTicket (MySQL/MariaDB en el servidor de la red).
 *
 * Es una fuente de datos SEPARADA de la PostgreSQL del sistema: osTicket es la
 * mesa de ayuda donde Moldes levanta los tickets de cambio de molde, y ahí es
 * donde vive esa información. No se replica a Postgres porque el volumen es
 * chico y el dato tiene que verse al día; se consulta en vivo y solo de lectura.
 *
 * El usuario de conexión debe tener SELECT y nada más. Nunca se escribe aquí.
 */
const pool = mysql.createPool({
  host: process.env.OSTICKET_DB_HOST,
  port: Number(process.env.OSTICKET_DB_PORT || 3306),
  database: process.env.OSTICKET_DB_NAME,
  user: process.env.OSTICKET_DB_USER,
  password: process.env.OSTICKET_DB_PASSWORD,
  // Deliberadamente bajo: osTicket atiende la mesa de ayuda de toda la planta
  // en vivo. Este pool es un invitado ahí, no puede acaparar conexiones.
  connectionLimit: 3,
  waitForConnections: true,
  connectTimeout: 8000,
  // Las fechas se manejan como texto para que MySQL no las reinterprete con la
  // zona horaria de Node: osTicket ya las guarda en la hora local de planta.
  dateStrings: true,
  timezone: "local",
});

/**
 * Tope de tiempo por consulta, del lado del SERVIDOR.
 *
 * Sin esto, una consulta pesada sigue corriendo en MariaDB aunque el cliente se
 * rinda: cortar en Node no mata nada del otro lado. Ya pasó una vez y dejó al
 * servidor sin atender conexiones nuevas, con osTicket caído para todos.
 *
 * `max_statement_time` es de MariaDB y va en segundos. Se aplica a cada
 * conexión nueva del pool. Si el servidor no lo soporta se ignora en silencio:
 * es una protección, no debe tumbar la aplicación.
 */
const LIMITE_SEGUNDOS = Number(process.env.OSTICKET_MAX_STATEMENT_TIME || 20);

pool.on("connection", (conexion) => {
  conexion.query(`SET SESSION max_statement_time = ${LIMITE_SEGUNDOS}`, (err) => {
    if (err) {
      console.warn(
        "⚠️  osTicket: no se pudo fijar max_statement_time —",
        err.message,
      );
    }
  });
});

/** ¿Está configurada la conexión? Sirve para no explotar si falta el .env. */
const configurado = () =>
  Boolean(process.env.OSTICKET_DB_HOST && process.env.OSTICKET_DB_USER);

async function query(sql, params = []) {
  const [filas] = await pool.execute(sql, params);
  return filas;
}

module.exports = { pool, query, configurado };
