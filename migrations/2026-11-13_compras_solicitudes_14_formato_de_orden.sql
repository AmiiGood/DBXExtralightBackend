-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 13: la orden autorizada alimenta Formatos
--
-- Fase 4 del flujo con firmas (Alexis, 13-nov-2026). Cuando una orden de
-- compra queda AUTORIZADA se escribe sola en compras_formatos, con lo mismo que
-- se capturaba del papel: ticket, fecha, área, requerimiento, monto, quién
-- firmó cada paso, tipo, cuenta y centro de costos. Así el reporte de Formatos
-- y el Tablero de Compras la cuentan sin capturarla.
--
-- Reglas:
--   - Fecha = el día en que quedó autorizada.
--   - Monto SIN IVA, en la moneda de la cotización (el presupuesto también es
--     sin IVA). El Tablero lo pasa a pesos o dólares como a los demás.
--   - Si Dirección no tuvo que firmar (abajo del mínimo), su casilla dice
--     "No requerida (abajo del mínimo)".
--   - Si ya había un formato en papel capturado con el mismo ticket, se liga a
--     la orden y se sobrescribe con lo firmado en el sistema.
--   - Los formatos que vienen de una orden (orden_id) no se corrigen ni se
--     borran desde Formatos: lo firmado no se edita.
--
-- La función compras_formato_de_orden(orden) la llama el backend al autorizar
-- (en la misma transacción) y aquí abajo se usa para las ya autorizadas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

ALTER TABLE public.compras_formatos
  ADD COLUMN IF NOT EXISTS orden_id integer REFERENCES public.compras_ordenes(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_formatos_orden
  ON public.compras_formatos (orden_id) WHERE orden_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.compras_formato_de_orden(p_orden integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  o     record;
  v_id  integer;
  v_iva numeric;
  v_obs text;
BEGIN
  SELECT od.id, od.estado, od.proveedor, od.monto, od.moneda, od.incluye_iva, od.comentario,
         od.clasif_tipo, od.cuenta, od.centro_costos, od.requiere_direccion, od.terminada_en,
         s.folio, s.asunto, s.osticket_numero, s.compras_area_id, s.solicitante_id,
         (SELECT u.nombre_completo FROM compras_orden_firmas f JOIN usuarios u ON u.id = f.usuario_id
           WHERE f.orden_id = od.id AND f.paso = 'GERENTE')   AS gerente,
         (SELECT u.nombre_completo FROM compras_orden_firmas f JOIN usuarios u ON u.id = f.usuario_id
           WHERE f.orden_id = od.id AND f.paso = 'COMPRAS')   AS compras,
         (SELECT u.nombre_completo FROM compras_orden_firmas f JOIN usuarios u ON u.id = f.usuario_id
           WHERE f.orden_id = od.id AND f.paso = 'FINANZAS')  AS finanzas,
         (SELECT u.nombre_completo FROM compras_orden_firmas f JOIN usuarios u ON u.id = f.usuario_id
           WHERE f.orden_id = od.id AND f.paso = 'DIRECCION') AS direccion
    INTO o
    FROM compras_ordenes od
    JOIN compras_solicitudes s ON s.id = od.solicitud_id
   WHERE od.id = p_orden;

  IF o.id IS NULL OR o.estado <> 'AUTORIZADA' THEN
    RETURN NULL;
  END IF;

  SELECT coalesce(iva_tasa, 0.16) INTO v_iva FROM compras_config WHERE id = 1;
  v_obs := 'Orden de compra firmada en el DBX (' || o.folio || '). Proveedor: ' || o.proveedor
           || '. Monto sin IVA.' || coalesce(' Comentario: ' || o.comentario, '');

  -- ¿Ya existe? La de esta orden, o una en papel con el mismo ticket
  SELECT id INTO v_id FROM compras_formatos WHERE orden_id = o.id;
  IF v_id IS NULL AND o.osticket_numero IS NOT NULL THEN
    SELECT id INTO v_id FROM compras_formatos
     WHERE orden_id IS NULL AND upper(btrim(ticket)) = upper(btrim(o.osticket_numero))
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO compras_formatos (ticket, fecha, compras_area_id, requerimiento, monto, moneda, capturado_por)
    VALUES (upper(o.osticket_numero), o.terminada_en::date, o.compras_area_id, o.asunto, 0, o.moneda, o.solicitante_id)
    RETURNING id INTO v_id;
  END IF;

  UPDATE compras_formatos
     SET orden_id           = o.id,
         ticket             = upper(o.osticket_numero),
         fecha              = o.terminada_en::date,
         compras_area_id    = o.compras_area_id,
         requerimiento      = o.asunto,
         monto              = round(CASE WHEN o.incluye_iva THEN o.monto / (1 + v_iva) ELSE o.monto END, 2),
         moneda             = o.moneda,
         autorizo_gerente   = o.gerente,
         clasif_tipo        = o.clasif_tipo,
         autorizo_compras   = o.compras,
         cuenta             = o.cuenta,
         centro_costos      = o.centro_costos,
         autorizo_finanzas  = o.finanzas,
         autorizo_direccion = CASE WHEN o.requiere_direccion IS FALSE THEN 'No requerida (abajo del mínimo)'
                                   ELSE o.direccion END,
         observaciones      = v_obs,
         actualizado_en     = now()
   WHERE id = v_id;

  RETURN v_id;
END;
$$;

-- Las que ya quedaron autorizadas antes de esta migración
SELECT public.compras_formato_de_orden(id) FROM public.compras_ordenes WHERE estado = 'AUTORIZADA';

COMMIT;
