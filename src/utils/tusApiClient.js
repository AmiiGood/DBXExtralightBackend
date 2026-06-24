const crypto = require("crypto");

/**
 * Cliente para la API de TUS que proporciona los mapeos QR → UPC
 *
 * Endpoint: http://lbldev.trs315.com/tustest/api/process
 * Método de firma: MD5(method + app_secret + businessData + first5 + last5)
 */

const TUS_API_URL =
  process.env.TUS_API_URL || "http://lbldev.trs315.com/tustest/api/process";
const TUS_APP_KEY = process.env.TUS_APP_KEY || "ed9b91-5a9dyu-8gd6p2-c9a592";
const TUS_APP_SECRET =
  process.env.TUS_APP_SECRET ||
  "5e2-fa-d3c44-2c1a-4c0-964c-a098g5-03b6-91c9-jk45-3bn9";
const TUS_METHOD = "get_crocs_qr_upc";

/**
 * Genera la firma MD5 requerida por la API TUS
 * @param {string} businessData - El JSON string de BusinessData
 * @returns {string} Firma MD5 en hexadecimal lowercase
 */
const generarFirma = (businessData) => {
  // Paso 1: Concatenar method + app_secret + businessData
  let str = TUS_METHOD + TUS_APP_SECRET + businessData;

  // Paso 2: Agregar los primeros y últimos 5 caracteres de la cadena
  const str1 = str.substring(0, 5);
  const str2 = str.substring(str.length - 5);
  str = str + str1 + str2;

  // Paso 3: Calcular MD5
  const sign = crypto.createHash("md5").update(str).digest("hex").toLowerCase();

  return sign;
};

/**
 * Llama a la API de TUS para obtener los mapeos QR → UPC
 * @param {string} lastGetTime - Fecha desde la cual obtener datos (formato: "YYYY-MM-DD HH:mm:ss")
 * @returns {Promise<Array<{QrCode: string, UPC: string}>>} Array de mapeos
 */
const fetchQrUpcMappings = async (lastGetTime) => {
  const businessData = JSON.stringify({ LastGetTime: lastGetTime });
  const sign = generarFirma(businessData);

  const body = { BusinessData: businessData };

  try {
    const response = await fetch(TUS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        method: TUS_METHOD,
        appKey: TUS_APP_KEY,
        sign: sign,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(
        `API TUS respondió con status ${response.status}: ${response.statusText}`,
      );
    }

    const result = await response.json();

    if (result.Success !== "true") {
      throw new Error(
        `API TUS error: ${result.Message || result.ErrorCode || "Error desconocido"}`,
      );
    }

    // El campo Data viene como string JSON, hay que parsearlo
    if (!result.Data) {
      return [];
    }

    const data =
      typeof result.Data === "string" ? JSON.parse(result.Data) : result.Data;

    return data;
  } catch (error) {
    console.error("❌ Error al llamar API TUS:", error.message);
    throw error;
  }
};

module.exports = {
  fetchQrUpcMappings,
  generarFirma,
  TUS_API_URL,
};
