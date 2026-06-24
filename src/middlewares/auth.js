const { verifyToken } = require("../utils/jwt");
const { AppError } = require("../utils/errorHandler");
const db = require("../config/database");

/**
 * Middleware para verificar que el usuario esté autenticado
 */
const authenticate = async (req, res, next) => {
  try {
    // Obtener token del header
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    console.log('🔐 Auth Header:', req.headers.authorization);
    console.log('🎫 Token extraído:', token ? token.substring(0, 20) + '...' : 'NO TOKEN');

    if (!token) {
      console.log('❌ No se encontró token en el header');
      return next(
        new AppError("No estás autenticado. Por favor inicia sesión.", 401)
      );
    }

    // Verificar token
    console.log('🔍 Verificando token...');
    const decoded = verifyToken(token);
    console.log('✅ Token decodificado:', decoded);

    // Verificar que el usuario todavía existe y está activo
    const query = `
      SELECT 
        u.id, 
        u.uuid,
        u.nombre_usuario, 
        u.email, 
        u.nombre_completo,
        u.activo,
        r.id as rol_id,
        r.nombre as rol_nombre,
        r.es_admin,
        a.id as area_id,
        a.nombre as area_nombre
      FROM usuarios u
      LEFT JOIN roles r ON u.rol_id = r.id
      LEFT JOIN areas a ON u.area_id = a.id
      WHERE u.id = $1
    `;

    const result = await db.query(query, [decoded.id]);

    if (result.rows.length === 0) {
      return next(new AppError("El usuario ya no existe.", 401));
    }

    const usuario = result.rows[0];

    if (!usuario.activo) {
      return next(
        new AppError(
          "Tu cuenta ha sido desactivada. Contacta al administrador.",
          401
        )
      );
    }

    // Agregar usuario al request
    req.usuario = {
      id: usuario.id,
      uuid: usuario.uuid,
      nombreUsuario: usuario.nombre_usuario,
      email: usuario.email,
      nombreCompleto: usuario.nombre_completo,
      rol: {
        id: usuario.rol_id,
        nombre: usuario.rol_nombre,
        esAdmin: usuario.es_admin,
      },
      area: {
        id: usuario.area_id,
        nombre: usuario.area_nombre,
      },
    };

    next();
  } catch (error) {
    console.error('❌ Error en authenticate:', error.message);
    console.error('Stack:', error.stack);
    next(
      new AppError(
        "Token inválido o expirado. Por favor inicia sesión nuevamente.",
        401
      )
    );
  }
};

/**
 * Middleware para verificar roles específicos
 * @param  {...String} roles - Roles permitidos
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.usuario) {
      return next(new AppError("Usuario no autenticado", 401));
    }

    if (!roles.includes(req.usuario.rol.nombre) && !req.usuario.rol.esAdmin) {
      return next(
        new AppError("No tienes permisos para realizar esta acción", 403)
      );
    }

    next();
  };
};

/**
 * Middleware para verificar si es administrador
 */
const isAdmin = (req, res, next) => {
  if (!req.usuario) {
    return next(new AppError("Usuario no autenticado", 401));
  }

  if (!req.usuario.rol.esAdmin) {
    return next(
      new AppError(
        "Esta acción solo puede ser realizada por administradores",
        403
      )
    );
  }

  next();
};

/**
 * Middleware para verificar permisos sobre un módulo específico
 * @param {String} moduloNombre - Nombre del módulo
 * @param {String} permiso - Tipo de permiso (leer, crear, editar, eliminar)
 */
const verificarPermiso = (moduloNombre, permiso) => {
  return async (req, res, next) => {
    try {
      // Los administradores tienen acceso a todo
      if (req.usuario.rol.esAdmin) {
        return next();
      }

      const query = `
        SELECT 
          rm.puede_leer,
          rm.puede_crear,
          rm.puede_editar,
          rm.puede_eliminar
        FROM roles_modulos rm
        JOIN modulos m ON rm.modulo_id = m.id
        WHERE rm.rol_id = $1 AND m.nombre = $2
      `;

      const result = await db.query(query, [req.usuario.rol.id, moduloNombre]);

      if (result.rows.length === 0) {
        return next(new AppError("No tienes acceso a este módulo", 403));
      }

      const permisos = result.rows[0];
      const permisoColumna = `puede_${permiso}`;

      if (!permisos[permisoColumna]) {
        return next(
          new AppError(`No tienes permiso para ${permiso} en este módulo`, 403)
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  authenticate,
  authorize,
  isAdmin,
  verificarPermiso,
};
