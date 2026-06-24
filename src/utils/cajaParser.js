/**
 * Utilidad para parsear códigos de cajas escaneadas en producción
 *
 * Formato esperado: 12345678$207013-410-C12$24$017
 * Partes:
 * - Parte 1: Código de caja (12345678)
 * - Parte 2: SKU (207013-410-C12)
 * - Parte 3: Cantidad de pares (24)
 * - Parte 4: Consecutivo (017)
 *
 * Problema conocido: El escáner a veces reemplaza los guiones por comillas simples
 * Ejemplo: 14012026$207013'410'C12$24$017
 */

/**
 * Normaliza y parsea el código de caja escaneado
 * @param {string} codigoRaw - Código crudo del escaneo
 * @returns {Object} - { codigoCaja, sku, cantidadPares, consecutivo, codigoCompleto, valido, error }
 */
const parseCaja = (codigoRaw) => {
  if (!codigoRaw || typeof codigoRaw !== "string") {
    return {
      valido: false,
      error: "Código de caja inválido o vacío",
    };
  }

  const codigoLimpio = codigoRaw.trim();

  // Normalizar: reemplazar comillas simples por guiones
  // 14012026$207013'410'C12$24$017 → 14012026$207013-410-C12$24$017
  const codigoNormalizado = codigoLimpio.replace(/'/g, "-");

  // Dividir por el separador $
  const partes = codigoNormalizado.split("$");

  // Debe tener exactamente 4 partes
  if (partes.length !== 4) {
    return {
      valido: false,
      error: `Formato inválido. Se esperaban 4 partes separadas por '$', se encontraron ${partes.length}`,
      codigoCompleto: codigoLimpio,
    };
  }

  const [codigoCaja, sku, cantidadStr, consecutivo] = partes;

  // Validar que no estén vacías
  if (!codigoCaja || !sku || !cantidadStr || !consecutivo) {
    return {
      valido: false,
      error: "Una o más partes del código están vacías",
      codigoCompleto: codigoLimpio,
    };
  }

  // Validar cantidad de pares
  const cantidadPares = parseInt(cantidadStr);
  if (isNaN(cantidadPares) || cantidadPares <= 0) {
    return {
      valido: false,
      error: `Cantidad de pares inválida: ${cantidadStr}`,
      codigoCompleto: codigoLimpio,
    };
  }

  // Validar que el SKU tenga un formato razonable
  if (sku.length < 3) {
    return {
      valido: false,
      error: `SKU demasiado corto: ${sku}`,
      codigoCompleto: codigoLimpio,
    };
  }

  return {
    valido: true,
    codigoCaja: codigoCaja.trim(),
    sku: sku.trim(),
    cantidadPares,
    consecutivo: consecutivo.trim(),
    codigoCompleto: codigoLimpio,
  };
};

/**
 * Valida si un código de caja tiene el formato correcto sin parsearlo completamente
 * @param {string} codigo - Código a validar
 * @returns {boolean}
 */
const esFormatoValido = (codigo) => {
  if (!codigo || typeof codigo !== "string") return false;

  const codigoNormalizado = codigo.trim().replace(/'/g, "-");
  const partes = codigoNormalizado.split("$");

  return partes.length === 4 && partes.every((p) => p.trim().length > 0);
};

/**
 * Extrae solo el SKU de un código de caja
 * @param {string} codigo - Código de caja
 * @returns {string|null} - SKU o null si no se puede extraer
 */
const extraerSku = (codigo) => {
  const resultado = parseCaja(codigo);
  return resultado.valido ? resultado.sku : null;
};

module.exports = {
  parseCaja,
  esFormatoValido,
  extraerSku,
};
