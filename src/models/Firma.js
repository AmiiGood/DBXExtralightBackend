const bcrypt = require("bcryptjs");
const db = require("../config/database");
const { AppError } = require("../utils/errorHandler");

/**
 * Firmas de los usuarios del DBX.
 *
 * Ver migrations/2026-11-13_firmas_01_usuarios.sql. Cada quien dibuja su firma
 * una vez y para firmar algo confirma con su PIN (4 a 6 dígitos). Registrar o
 * cambiar la firma pide la contraseña del DBX. 5 PIN equivocados seguidos la
 * bloquean 15 minutos.
 *
 * Los módulos que firman (la orden de compra, fase 3) llaman a `verificar` con
 * el PIN y guardan el id de la firma con la que se firmó.
 */

const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
const MAX_BYTES = 300 * 1024;
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const aDataUrl = (buf) => (buf ? `data:image/png;base64,${Buffer.from(buf).toString("base64")}` : null);

/** "data:image/png;base64,…" → Buffer, revisando que de verdad sea un PNG. */
function leerImagen(dataUrl) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m) throw new AppError("Dibuja tu firma antes de guardar", 400);
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 100 || !buf.subarray(0, 8).equals(FIRMA_PNG)) throw new AppError("La firma no es una imagen válida", 400);
  if (buf.length > MAX_BYTES) throw new AppError("La firma pesa demasiado; bórrala y dibújala de nuevo", 400);
  return buf;
}

/** El PIN: 4 a 6 dígitos, que no sea todo el mismo número ni una escalera. */
function revisarPin(pin) {
  const p = String(pin ?? "");
  if (!/^\d{4,6}$/.test(p)) throw new AppError("El PIN debe tener de 4 a 6 números", 400);
  if (/^(\d)\1+$/.test(p)) throw new AppError("El PIN no puede ser el mismo número repetido", 400);
  const sube = "0123456789".includes(p);
  const baja = "9876543210".includes(p);
  if (sube || baja) throw new AppError("El PIN no puede ser una escalera como 1234", 400);
  return p;
}

class Firma {
  static MAX_INTENTOS = MAX_INTENTOS;

  /** La firma activa del usuario, para mostrarla (sin el PIN). */
  static async mia(usuarioId) {
    const { rows } = await db.query(
      `SELECT id, imagen, to_char(creada_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creada_en,
              CASE WHEN bloqueada_hasta > now() THEN to_char(bloqueada_hasta, 'YYYY-MM-DD"T"HH24:MI:SS') END AS bloqueada_hasta
         FROM usuarios_firmas WHERE usuario_id = $1 AND activa`,
      [usuarioId],
    );
    const f = rows[0];
    return f
      ? { registrada: true, id: f.id, imagen: aDataUrl(f.imagen), creada_en: f.creada_en, bloqueada_hasta: f.bloqueada_hasta }
      : { registrada: false };
  }

  /**
   * Registra (o cambia) la firma. Pide la contraseña del DBX del usuario.
   * La anterior queda inactiva.
   */
  static async registrar(usuarioId, { imagen, pin, password }) {
    const buf = leerImagen(imagen);
    const p = revisarPin(pin);
    const { rows: u } = await db.query("SELECT password_hash FROM usuarios WHERE id = $1 AND activo", [usuarioId]);
    if (!u[0] || !password || !(await bcrypt.compare(String(password), u[0].password_hash))) {
      // 400 y no 401: el frontend toma un 401 como sesión vencida y te saca
      throw new AppError("La contraseña del DBX no es correcta", 400);
    }
    const pinHash = await bcrypt.hash(p, 10);
    const cliente = await db.pool.connect();
    try {
      await cliente.query("BEGIN");
      const { rowCount: cambio } = await cliente.query(
        `UPDATE usuarios_firmas SET activa = false, desactivada_en = now(), desactivada_por = $1
          WHERE usuario_id = $1 AND activa`,
        [usuarioId],
      );
      const { rows } = await cliente.query(
        `INSERT INTO usuarios_firmas (usuario_id, imagen, pin_hash) VALUES ($1, $2, $3) RETURNING id`,
        [usuarioId, buf, pinHash],
      );
      await cliente.query("COMMIT");
      return { id: rows[0].id, cambio: cambio > 0 };
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  /**
   * Revisa el PIN del usuario y regresa su firma activa ({ id, imagen }).
   * Cuenta los intentos fallidos y bloquea al quinto.
   *
   * @param {Object} [cliente]  para hacerlo dentro de la transacción de quien firma
   */
  static async verificar(usuarioId, pin, cliente = db) {
    const { rows } = await cliente.query(
      `SELECT id, imagen, pin_hash, intentos_fallidos,
              bloqueada_hasta > now() AS bloqueada,
              ceil(extract(epoch FROM bloqueada_hasta - now()) / 60)::int AS minutos
         FROM usuarios_firmas WHERE usuario_id = $1 AND activa`,
      [usuarioId],
    );
    const f = rows[0];
    if (!f) throw new AppError("Todavía no registras tu firma. Regístrala en \"Mi firma\".", 409);
    if (f.bloqueada) {
      throw new AppError(`Tu firma está bloqueada por PIN equivocados. Intenta en ${f.minutos} min.`, 423);
    }
    const ok = /^\d{4,6}$/.test(String(pin ?? "")) && (await bcrypt.compare(String(pin), f.pin_hash));
    if (!ok) {
      const intentos = f.intentos_fallidos + 1;
      const bloquear = intentos >= MAX_INTENTOS;
      // Fuera de la transacción de quien firma: el intento cuenta aunque se deshaga lo demás
      await db.query(
        `UPDATE usuarios_firmas
            SET intentos_fallidos = $2,
                bloqueada_hasta = CASE WHEN $3 THEN now() + make_interval(mins => $4) END
          WHERE id = $1`,
        [f.id, bloquear ? 0 : intentos, bloquear, MINUTOS_BLOQUEO],
      );
      throw new AppError(
        bloquear
          ? `PIN equivocado. Tu firma quedó bloqueada ${MINUTOS_BLOQUEO} minutos.`
          : MAX_INTENTOS - intentos === 1
            ? "PIN equivocado. Te queda 1 intento."
            : `PIN equivocado. Te quedan ${MAX_INTENTOS - intentos} intentos.`,
        400,
      );
    }
    if (f.intentos_fallidos > 0) {
      await db.query("UPDATE usuarios_firmas SET intentos_fallidos = 0 WHERE id = $1", [f.id]);
    }
    return { id: f.id, imagen: aDataUrl(f.imagen) };
  }

  /** La imagen de una firma (activa o no): para estampar lo ya firmado. */
  static async imagen(firmaId) {
    const { rows } = await db.query("SELECT imagen FROM usuarios_firmas WHERE id = $1", [firmaId]);
    return rows[0] ? aDataUrl(rows[0].imagen) : null;
  }

  /** Para el admin: quién tiene firma registrada. */
  static async listar() {
    const { rows } = await db.query(
      `SELECT u.id AS usuario_id, u.nombre_completo, u.nombre_usuario, r.nombre AS rol,
              to_char(f.creada_en, 'YYYY-MM-DD"T"HH24:MI:SS') AS creada_en,
              f.bloqueada_hasta > now() AS bloqueada
         FROM usuarios_firmas f
         JOIN usuarios u ON u.id = f.usuario_id
         LEFT JOIN roles r ON r.id = u.rol_id
        WHERE f.activa
        ORDER BY u.nombre_completo`,
    );
    return rows;
  }

  /** El admin quita la firma de alguien (olvidó el PIN, la firma salió mal…). */
  static async quitar(usuarioId, adminId) {
    const { rows } = await db.query(
      `UPDATE usuarios_firmas SET activa = false, desactivada_en = now(), desactivada_por = $2
        WHERE usuario_id = $1 AND activa
        RETURNING id`,
      [usuarioId, adminId],
    );
    if (!rows[0]) throw new AppError("Esa persona no tiene firma registrada", 404);
    return rows[0];
  }
}

module.exports = Firma;
