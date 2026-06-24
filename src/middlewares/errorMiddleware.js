const { sendError } = require("../utils/errorHandler");

/**
 * Maneja errores de desarrollo
 */
const sendErrorDev = (err, res) => {
  res.status(err.statusCode || 500).json({
    status: err.status || "error",
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

/**
 * Maneja errores de producción
 */
const sendErrorProd = (err, res) => {
  // Error operacional confiable: enviar mensaje al cliente
  if (err.isOperational) {
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }
  // Error de programación u otro error desconocido: no filtrar detalles
  else {
    console.error("ERROR 💥:", err);
    res.status(500).json({
      status: "error",
      message: "Algo salió muy mal!",
    });
  }
};

/**
 * Maneja errores de PostgreSQL
 */
const handleDatabaseError = (err) => {
  // Violación de unique constraint
  if (err.code === "23505") {
    const field = err.detail?.match(/Key \((.*?)\)=/)?.[1] || "campo";
    return {
      statusCode: 400,
      message: `El ${field} ya existe en el sistema`,
      isOperational: true,
    };
  }

  // Violación de foreign key
  if (err.code === "23503") {
    return {
      statusCode: 400,
      message: "Referencia inválida a otro registro",
      isOperational: true,
    };
  }

  // Violación de not null
  if (err.code === "23502") {
    const column = err.column || "campo requerido";
    return {
      statusCode: 400,
      message: `El campo '${column}' es requerido`,
      isOperational: true,
    };
  }

  // Violación de check constraint
  if (err.code === "23514") {
    return {
      statusCode: 400,
      message: "Los datos no cumplen con las validaciones requeridas",
      isOperational: true,
    };
  }

  return null;
};

/**
 * Middleware global de manejo de errores
 */
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Manejar errores específicos de PostgreSQL
    const dbError = handleDatabaseError(err);
    if (dbError) {
      error.statusCode = dbError.statusCode;
      error.message = dbError.message;
      error.isOperational = dbError.isOperational;
    }

    // Manejar errores de validación de express-validator
    if (err.array && typeof err.array === "function") {
      error.statusCode = 400;
      error.message = "Error de validación";
      error.isOperational = true;
    }

    sendErrorProd(error, res);
  }
};

/**
 * Middleware para rutas no encontradas
 */
const notFound = (req, res, next) => {
  res.status(404).json({
    status: "error",
    message: `No se puede encontrar ${req.originalUrl} en este servidor`,
  });
};

module.exports = {
  errorHandler,
  notFound,
};
