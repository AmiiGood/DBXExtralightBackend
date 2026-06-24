/**
 * Valida que los totales de POs y Cartones cuadren
 * @param {Array} pos - Array de POs parseadas del Excel
 * @param {Array} cartones - Array de Cartones parseados del Excel
 * @returns {Object} { valido: boolean, errores: [] }
 */
const validateShippingData = (pos, cartones) => {
  const errores = [];

  // Crear un mapa de POs para acceso rápido
  const posMap = {};
  pos.forEach((po) => {
    posMap[po.poNumber] = {
      cantidadPares: po.cantidadPares,
      cantidadCartones: po.cantidadCartones,
      paresContados: 0,
      cartonesContados: new Set(),
    };
  });

  // Validar cada cartón
  cartones.forEach((carton) => {
    const { cartonId, sku, cantidadPorCarton, poNumber } = carton;

    // Verificar que la PO existe
    if (!posMap[poNumber]) {
      errores.push({
        tipo: "PO_NO_ENCONTRADA",
        cartonId,
        poNumber,
        error: `El cartón ${cartonId} referencia una PO (${poNumber}) que no existe en la hoja PO`,
      });
      return;
    }

    // Acumular pares
    posMap[poNumber].paresContados += cantidadPorCarton;

    // Contar cartón único
    posMap[poNumber].cartonesContados.add(cartonId);
  });

  // Validar totales por cada PO
  Object.keys(posMap).forEach((poNumber) => {
    const po = posMap[poNumber];

    // Validar cantidad de pares
    if (po.paresContados !== po.cantidadPares) {
      errores.push({
        tipo: "PARES_NO_CUADRAN",
        poNumber,
        esperado: po.cantidadPares,
        encontrado: po.paresContados,
        diferencia: po.paresContados - po.cantidadPares,
        error: `PO ${poNumber}: La suma de pares en cartones (${po.paresContados}) no coincide con CantidadPares declarada (${po.cantidadPares})`,
      });
    }

    // Validar cantidad de cartones
    const cartonesUnicos = po.cartonesContados.size;
    if (cartonesUnicos !== po.cantidadCartones) {
      errores.push({
        tipo: "CARTONES_NO_CUADRAN",
        poNumber,
        esperado: po.cantidadCartones,
        encontrado: cartonesUnicos,
        diferencia: cartonesUnicos - po.cantidadCartones,
        error: `PO ${poNumber}: La cantidad de cartones únicos (${cartonesUnicos}) no coincide con CantidadCartones declarada (${po.cantidadCartones})`,
      });
    }
  });

  return {
    valido: errores.length === 0,
    errores,
    resumen: Object.keys(posMap).map((poNumber) => ({
      poNumber,
      paresEsperados: posMap[poNumber].cantidadPares,
      paresEncontrados: posMap[poNumber].paresContados,
      cartonesEsperados: posMap[poNumber].cantidadCartones,
      cartonesEncontrados: posMap[poNumber].cartonesContados.size,
    })),
  };
};

/**
 * Identifica el tipo de cada cartón (MONO o MUSICAL)
 * @param {Array} cartones - Array de cartones
 * @returns {Array} Cartones con campo 'tipo' agregado
 */
const identificarTipoCartones = (cartones) => {
  // Agrupar por cartonId
  const cartonesMap = {};

  cartones.forEach((carton) => {
    if (!cartonesMap[carton.cartonId]) {
      cartonesMap[carton.cartonId] = [];
    }
    cartonesMap[carton.cartonId].push(carton);
  });

  // Determinar tipo
  const cartonesConTipo = [];

  Object.keys(cartonesMap).forEach((cartonId) => {
    const cartonesDelId = cartonesMap[cartonId];
    const skusUnicos = new Set(cartonesDelId.map((c) => c.sku));

    // Si tiene más de 1 SKU único, es MUSICAL
    const tipo = skusUnicos.size > 1 ? "MUSICAL" : "MONO";

    cartonesDelId.forEach((carton) => {
      cartonesConTipo.push({
        ...carton,
        tipo,
      });
    });
  });

  return cartonesConTipo;
};

/**
 * Valida que no haya cartones duplicados con diferente información
 * @param {Array} cartones - Array de cartones
 * @returns {Object} { valido: boolean, errores: [] }
 */
const validateCartonConsistency = (cartones) => {
  const errores = [];
  const cartonesMap = {};

  cartones.forEach((carton, index) => {
    const key = `${carton.cartonId}-${carton.sku}`;

    if (cartonesMap[key]) {
      // Verificar que la cantidad y PO sean iguales
      const anterior = cartonesMap[key];

      if (anterior.cantidadPorCarton !== carton.cantidadPorCarton) {
        errores.push({
          tipo: "CANTIDAD_INCONSISTENTE",
          cartonId: carton.cartonId,
          sku: carton.sku,
          error: `Cartón ${carton.cartonId} con SKU ${carton.sku} tiene cantidades diferentes: ${anterior.cantidadPorCarton} vs ${carton.cantidadPorCarton}`,
        });
      }

      if (anterior.poNumber !== carton.poNumber) {
        errores.push({
          tipo: "PO_INCONSISTENTE",
          cartonId: carton.cartonId,
          sku: carton.sku,
          error: `Cartón ${carton.cartonId} con SKU ${carton.sku} pertenece a diferentes POs: ${anterior.poNumber} vs ${carton.poNumber}`,
        });
      }
    } else {
      cartonesMap[key] = carton;
    }
  });

  return {
    valido: errores.length === 0,
    errores,
  };
};

module.exports = {
  validateShippingData,
  identificarTipoCartones,
  validateCartonConsistency,
};
