/**
 * Clase personalizada para errores de la aplicación
 */
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "fail" : "error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Maneja errores asíncronos en rutas Express
 */
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

/**
 * Función para respuestas exitosas estandarizadas
 */
const sendSuccess = (res, statusCode, data, message = "Operación exitosa") => {
  res.status(statusCode).json({
    status: "success",
    message,
    data,
  });
};

/**
 * Función para respuestas de error estandarizadas
 */
const sendError = (res, statusCode, message, errors = null) => {
  const response = {
    status: "error",
    message,
  };

  if (errors) {
    response.errors = errors;
  }

  res.status(statusCode).json(response);
};

module.exports = {
  AppError,
  catchAsync,
  sendSuccess,
  sendError,
};
