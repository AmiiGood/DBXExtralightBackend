-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 8: catálogos de tipo (Compras) y cuenta (Finanzas)
--
-- Compras y Finanzas mandaron sus listas (11-nov-2026):
--   - "Tipos Compras.xlsx": 27 tipos de compra.
--   - "Cuentas.xlsx": 48 cuentas contables (número y nombre).
-- Hasta hoy el formato los guardaba como texto libre. Desde esta migración la
-- captura los escoge de la lista.
--
-- Decisiones:
--   - compras_formatos sigue guardando el texto (el nombre del tipo y el número
--     de la cuenta), sin llave foránea: lo ya capturado que no esté en la lista
--     no se pierde ni truena; la pantalla lo marca como "fuera de la lista".
--   - Renombrar un tipo actualiza también los formatos que lo usan (lo hace el
--     backend). Un tipo o cuenta que ya no se usa se desactiva, no se borra.
--   - Centro de costos sigue libre: todavía no hay lista.
--   - "SUPPLY CHAIN" y "SOFTWARE" se escriben como los demás (Supply Chain,
--     Software); CAPEX, MRO y NPI son siglas y se quedan así.
--
-- Idempotente.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.compras_tipos (
  id              serial        PRIMARY KEY,
  nombre          varchar(120)  NOT NULL,
  activo          boolean       NOT NULL DEFAULT true,
  actualizado_por integer       REFERENCES public.usuarios(id),
  actualizado_en  timestamp     NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_compras_tipos_nombre ON public.compras_tipos (lower(nombre));

CREATE TABLE IF NOT EXISTS public.compras_cuentas (
  -- Número de la cuenta contable, solo dígitos (p. ej. 6202000014)
  codigo          varchar(20)   PRIMARY KEY CHECK (codigo ~ '^[0-9]+$'),
  nombre          varchar(120)  NOT NULL,
  activo          boolean       NOT NULL DEFAULT true,
  actualizado_por integer       REFERENCES public.usuarios(id),
  actualizado_en  timestamp     NOT NULL DEFAULT now()
);

INSERT INTO public.compras_tipos (nombre)
SELECT t.nombre
  FROM (VALUES
    ('Capacitaciones'), ('Certificaciones'), ('Consumibles'), ('Envíos'),
    ('Equipo de Protección Personal'), ('Equipo y Maquinaria'), ('Gastos Especiales'),
    ('Hardware'), ('Herramientas'), ('Licencias'), ('Medicamentos'),
    ('Moldes y Herramentales'), ('Muebles y Mobiliario'), ('NPI'), ('Outsourcing'),
    ('Papelería'), ('Refacciones'), ('Regalos'), ('Renta de equipos'),
    ('Reparación y mejora de áreas'), ('Reparación y mejora de equipos'), ('Servicios'),
    ('Uniformes'), ('Supply Chain'), ('CAPEX'), ('Software'), ('MRO')
  ) AS t(nombre)
 WHERE NOT EXISTS (SELECT 1 FROM public.compras_tipos x WHERE lower(x.nombre) = lower(t.nombre));

INSERT INTO public.compras_cuentas (codigo, nombre) VALUES
  ('3803000017', 'ACTIVO FIJO EN PROCESO'),
  ('6402000001', 'Wood Expenses'),
  ('6402000003', 'GASTOS DE PROMOCIÓN'),
  ('6402000011', 'AUTO EXPENSES ADMINISTRATION'),
  ('6402000014', 'SALES EXPENSES'),
  ('6403000004', 'SALES COMMISSIONS'),
  ('6403000007', 'FREIGHT CHARGES'),
  ('6403000008', 'COSTO DE FLETES DE EXPORTACION'),
  ('6403000012', 'FLETES LOCALES SIN RETENCION'),
  ('6403000014', 'REGALIAS POR MARCA Y PATENTE'),
  ('5701000007', 'FLETE PARA IMPORTACIÓN'),
  ('5701000008', 'HONORARIOS/GASTOS AGENTES ADUANALES'),
  ('5901000003', 'COMPRA DE MOLDES'),
  ('6201000015', 'MANO DE OBRA INDIRECTA'),
  ('6201000017', 'HONORARIOS DE SUBCONTRATISTAS DIR'),
  ('6201000018', 'HONORARIOS DE SUBCONTRATISTAS IND'),
  ('6201000053', 'GASOLINA'),
  ('6201000066', 'GASOLINA INDIRECTOS'),
  ('6202000002', 'ELECTRICIDAD Y AGUA EN PLANTA'),
  ('6202000006', 'CONSULTORES DE PRODUCCIÓN'),
  ('6202000007', 'MANTENIMIENTO MOLDES'),
  ('6202000014', 'MANTENIMIENTO MAQUINARIA'),
  ('6202000016', 'GASTOS DE PRODUCCIÓN INDIRECTOS'),
  ('6204000006', 'GASTOS DE VIAJE INDIRECTOS'),
  ('6205000001', 'RENTA DE MAQUINARIA (EXTRUSORAS)'),
  ('6205000002', 'RENTA'),
  ('6205000004', 'EQUIPO RENTADO'),
  ('6301000005', 'GASTOS DE VIAJE ADMINISTRACIÓN'),
  ('6301000024', 'ATENCION A EMPLEADOS'),
  ('6302000002', 'TELEFONO E INTERNET'),
  ('6302000005', 'PAPELERIA Y CONSUMIBLES'),
  ('6302000006', 'CONSULTORES LEGALES'),
  ('6302000008', 'FACILITIES'),
  ('6302000012', 'RENTA ADMINISTRACIÓN'),
  ('6302000016', 'SERVICIO LIMPIEZA ADMINISTRACIÓN'),
  ('6302000017', 'LICENCIAS Y SUSCRIPCIONES'),
  ('6302000019', 'OTROS GASTOS'),
  ('6302000025', 'HONORARIOS SERVICIO PARA ADMINIST'),
  ('6302000026', 'SERVICIO DE SEGURIDAD'),
  ('6302000030', 'FLETES Y ENTREGAS VENTAS Y ADMINISTRACI'),
  ('6302000031', 'EQUIPO RENTADO (COPIADORAS)'),
  ('6302000032', 'CONSULTORES ADMINISTRACIÓN'),
  ('6302000034', 'SERVICIO POR EMISIÓN DE VALES EDENRED'),
  ('6302000035', 'CONSULTORES DE CONTABILIDAD Y AUDITORIA'),
  ('6302000036', 'CONTRATISTAS DE MAQUILA'),
  ('6302000043', 'GASTOS DE TRANSACCIÓN'),
  ('6302000044', 'TARIFA DE SERVICIOS ADMINISTRATIVOS IC'),
  ('6302000045', 'DESAROLLO DE PRODUCTO'),
  ('6302000046', 'CONSUMIBLES IT')
ON CONFLICT (codigo) DO NOTHING;

-- Lo ya capturado a mano: si coincide con la lista salvo mayúsculas, espacios
-- o guiones, se deja escrito igual que en la lista
UPDATE public.compras_formatos f
   SET clasif_tipo = t.nombre
  FROM public.compras_tipos t
 WHERE lower(btrim(f.clasif_tipo)) = lower(t.nombre)
   AND f.clasif_tipo IS DISTINCT FROM t.nombre;

UPDATE public.compras_formatos f
   SET cuenta = c.codigo
  FROM public.compras_cuentas c
 WHERE regexp_replace(f.cuenta, '[^0-9]', '', 'g') = c.codigo
   AND f.cuenta IS DISTINCT FROM c.codigo;

COMMIT;
