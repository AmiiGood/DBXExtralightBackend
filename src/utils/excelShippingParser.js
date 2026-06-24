const XLSX = require("xlsx");

/**
 * Parsea el archivo Excel de POs y Cartones
 * @param {String} filePath - Ruta del archivo Excel
 * @returns {Object} { pos: [], cartones: [], errores: [] }
 */
const parseShippingExcel = (filePath) => {
  const errores = [];

  try {
    // Leer el archivo Excel
    const workbook = XLSX.readFile(filePath);

    // Verificar que existan las hojas requeridas
    if (!workbook.SheetNames.includes("PO")) {
      throw new Error('El archivo debe contener una hoja llamada "PO"');
    }

    if (!workbook.SheetNames.includes("Cartones")) {
      throw new Error('El archivo debe contener una hoja llamada "Cartones"');
    }

    // Parsear hoja de POs
    const sheetPO = workbook.Sheets["PO"];
    const dataPOs = XLSX.utils.sheet_to_json(sheetPO, { defval: "" });

    // Parsear hoja de Cartones
    const sheetCartones = workbook.Sheets["Cartones"];
    const dataCartones = XLSX.utils.sheet_to_json(sheetCartones, {
      defval: "",
    });

    // Procesar POs
    const pos = [];
    for (let i = 0; i < dataPOs.length; i++) {
      const row = dataPOs[i];

      try {
        // Buscar columnas (flexible con mayúsculas/minúsculas)
        const keys = Object.keys(row);
        const findKey = (names) =>
          keys.find((k) => names.includes(k.toLowerCase().trim()));

        const poNumberKey = findKey([
          "ponumber",
          "po_number",
          "po number",
          "po",
        ]);
        const cantidadParesKey = findKey([
          "cantidadpares",
          "cantidad_pares",
          "cantidad pares",
          "pares",
        ]);
        const cantidadCartonesKey = findKey([
          "cantidadcartones",
          "cantidad_cartones",
          "cantidad cartones",
          "cartones",
        ]);
        const cfmxfDateKey = findKey([
          "cfmxfdate",
          "cfmxf_date",
          "cfmxf date",
          "fecha",
        ]);

        if (
          !poNumberKey ||
          !cantidadParesKey ||
          !cantidadCartonesKey ||
          !cfmxfDateKey
        ) {
          errores.push({
            fila: i + 2,
            hoja: "PO",
            error:
              "Faltan columnas requeridas: PONumber, CantidadPares, CantidadCartones, CfmXfDate",
          });
          continue;
        }

        const poNumber = String(row[poNumberKey]).trim();
        const cantidadPares = parseInt(row[cantidadParesKey]);
        const cantidadCartones = parseInt(row[cantidadCartonesKey]);
        let cfmxfDate = row[cfmxfDateKey];

        // Validaciones
        if (!poNumber) {
          errores.push({
            fila: i + 2,
            hoja: "PO",
            error: "PONumber vacío",
          });
          continue;
        }

        if (isNaN(cantidadPares) || cantidadPares <= 0) {
          errores.push({
            fila: i + 2,
            hoja: "PO",
            poNumber,
            error: "CantidadPares inválida",
          });
          continue;
        }

        if (isNaN(cantidadCartones) || cantidadCartones <= 0) {
          errores.push({
            fila: i + 2,
            hoja: "PO",
            poNumber,
            error: "CantidadCartones inválida",
          });
          continue;
        }

        // Parsear fecha (puede venir como número serial de Excel)
        if (typeof cfmxfDate === "number") {
          cfmxfDate = XLSX.SSF.parse_date_code(cfmxfDate);
          cfmxfDate = new Date(
            cfmxfDate.y,
            cfmxfDate.m - 1,
            cfmxfDate.d,
          ).toISOString();
        } else if (typeof cfmxfDate === "string") {
          cfmxfDate = new Date(cfmxfDate).toISOString();
        }

        pos.push({
          poNumber,
          cantidadPares,
          cantidadCartones,
          cfmxfDate,
        });
      } catch (error) {
        errores.push({
          fila: i + 2,
          hoja: "PO",
          error: `Error al procesar fila: ${error.message}`,
        });
      }
    }

    // Procesar Cartones
    const cartones = [];
    for (let i = 0; i < dataCartones.length; i++) {
      const row = dataCartones[i];

      try {
        // Buscar columnas
        const keys = Object.keys(row);
        const findKey = (names) =>
          keys.find((k) => names.includes(k.toLowerCase().trim()));

        const cartonIdKey = findKey([
          "cartonid",
          "carton_id",
          "carton id",
          "carton",
        ]);
        const skuKey = findKey(["sku", "style"]);
        const cantidadKey = findKey([
          "cantidadporcarton",
          "cantidad_por_carton",
          "cantidad por carton",
          "cantidad",
        ]);
        const poNumberKey = findKey([
          "ponumber",
          "po_number",
          "po number",
          "po",
        ]);

        if (!cartonIdKey || !skuKey || !cantidadKey || !poNumberKey) {
          errores.push({
            fila: i + 2,
            hoja: "Cartones",
            error:
              "Faltan columnas requeridas: CartonID, SKU, CantidadPorCarton, PONumber",
          });
          continue;
        }

        const cartonId = String(row[cartonIdKey]).trim();
        const sku = String(row[skuKey]).trim();
        const cantidadPorCarton = parseInt(row[cantidadKey]);
        const poNumber = String(row[poNumberKey]).trim();

        // Validaciones
        if (!cartonId) {
          errores.push({
            fila: i + 2,
            hoja: "Cartones",
            error: "CartonID vacío",
          });
          continue;
        }

        if (!sku) {
          errores.push({
            fila: i + 2,
            hoja: "Cartones",
            cartonId,
            error: "SKU vacío",
          });
          continue;
        }

        if (isNaN(cantidadPorCarton) || cantidadPorCarton <= 0) {
          errores.push({
            fila: i + 2,
            hoja: "Cartones",
            cartonId,
            error: "CantidadPorCarton inválida",
          });
          continue;
        }

        if (!poNumber) {
          errores.push({
            fila: i + 2,
            hoja: "Cartones",
            cartonId,
            error: "PONumber vacío",
          });
          continue;
        }

        cartones.push({
          cartonId,
          sku,
          cantidadPorCarton,
          poNumber,
        });
      } catch (error) {
        errores.push({
          fila: i + 2,
          hoja: "Cartones",
          error: `Error al procesar fila: ${error.message}`,
        });
      }
    }

    return { pos, cartones, errores };
  } catch (error) {
    throw new Error(`Error al leer el archivo Excel: ${error.message}`);
  }
};

module.exports = {
  parseShippingExcel,
};
