/**
 * Utilidad para normalizar códigos QR escaneados.
 *
 * El escáner físico produce cadenas como:
 *   httpsÑ--verify.crocs.com-Q-TN6AKYGBSEIW
 *
 * La API TUS devuelve URLs como:
 *   http://192.168.0.249:500/Q/3TTAKYGBLOXJ
 *
 * Ambos deben resolverse al mismo identificador único (ej: TN6AKYGBSEIW)
 */

/**
 * Extrae el código identificador único de un QR escaneado o de una URL de la API TUS
 * @param {string} raw - Texto crudo del QR (del escáner o de la API)
 * @returns {string} Código normalizado en mayúsculas
 */
const normalizarQR = (raw) => {
  if (!raw || typeof raw !== "string") {
    return null;
  }

  let texto = raw.trim();

  // Caso 1: URL de la API TUS → http://192.168.0.249:500/Q/XXXXXX
  // Extraer lo que viene después de /Q/
  const matchUrlTus = texto.match(/\/Q\/([A-Za-z0-9]+)$/i);
  if (matchUrlTus) {
    return matchUrlTus[1].toUpperCase();
  }

  // Caso 2: Lectura del escáner físico → httpsÑ--verify.crocs.com-Q-XXXXXX
  // El escáner reemplaza :// por Ñ-- y / por -
  const matchEscaner = texto.match(/-Q-([A-Za-z0-9]+)$/i);
  if (matchEscaner) {
    return matchEscaner[1].toUpperCase();
  }

  // Caso 3: URL normal de verify.crocs.com → https://verify.crocs.com/Q/XXXXXX
  const matchVerify = texto.match(/verify\.crocs\.com\/Q\/([A-Za-z0-9]+)$/i);
  if (matchVerify) {
    return matchVerify[1].toUpperCase();
  }

  // Caso 4: Si ya es solo el código (alfanumérico puro de 12 caracteres aprox)
  const matchCodigo = texto.match(/^[A-Za-z0-9]{8,20}$/);
  if (matchCodigo) {
    return texto.toUpperCase();
  }

  // No se pudo normalizar — devolver en mayúsculas como fallback
  return texto.toUpperCase();
};

/**
 * Normaliza una URL QR de la API TUS para almacenamiento
 * @param {string} qrUrl - URL completa del QR desde la API TUS
 * @returns {string} Código normalizado
 */
const normalizarQrDesdeApi = (qrUrl) => {
  return normalizarQR(qrUrl);
};

module.exports = {
  normalizarQR,
  normalizarQrDesdeApi,
};
