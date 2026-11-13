-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 10: grupos de cuentas para el Tablero
--
-- Finanzas agrupa las cuentas en renglones del P&L de Finproject. El Tablero
-- de Compras muestra dos (13-nov-2026): MANUTENZIONE (mantenimiento) y ALTRI
-- COSTI FISSI (otros costos fijos), con el gasto de cada concepto.
--
-- Decisiones (Alexis, 13-nov-2026):
--   - Una cuenta puede estar en más de un grupo: 6302000046 (IT) cuenta en los
--     dos. Cada gráfica es independiente; no se suman entre sí.
--   - Las barras van por concepto: las cuentas con el mismo concepto se juntan
--     (sin importar mayúsculas: "VENTA" y "Venta" son uno).
--   - 6204000004 (HSE) y 6302000018 (Seguro de activos) no estaban en la lista
--     de Finanzas: se agregan con ese nombre (se puede corregir en Listas).
--   - Conceptos tal como los mandó Finanzas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.compras_cuentas (codigo, nombre) VALUES
  ('6204000004', 'HSE'),
  ('6302000018', 'SEGURO DE ACTIVOS')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.compras_grupos_cuenta (
  -- Renglón del P&L, como lo escribe Finanzas (p. ej. 'MANUTENZIONE')
  grupo        varchar(60)   NOT NULL,
  -- Orden en el que se muestran los grupos
  grupo_orden  smallint      NOT NULL DEFAULT 0,
  codigo       varchar(20)   NOT NULL REFERENCES public.compras_cuentas(codigo),
  -- Para qué es la cuenta dentro del grupo; las cuentas con el mismo concepto
  -- son una sola barra
  concepto     varchar(120)  NOT NULL,
  PRIMARY KEY (grupo, codigo)
);

COMMENT ON TABLE public.compras_grupos_cuenta IS
  'Cuentas contables agrupadas en renglones del P&L (Finanzas). Una cuenta puede estar en varios grupos.';

INSERT INTO public.compras_grupos_cuenta (grupo, grupo_orden, codigo, concepto) VALUES
  ('MANUTENZIONE', 1, '6202000007', 'MULDE'),
  ('MANUTENZIONE', 1, '6202000014', 'MANTENIMIENTO'),
  ('MANUTENZIONE', 1, '6202000016', 'TODAS LAS AREAS'),
  ('MANUTENZIONE', 1, '6302000005', 'COMPRA'),
  ('MANUTENZIONE', 1, '6302000008', 'FACILITY'),
  ('MANUTENZIONE', 1, '6302000046', 'IT'),
  ('MANUTENZIONE', 1, '6402000001', 'HSE'),
  ('MANUTENZIONE', 1, '5901000003', 'CUSTOMER SERVICE'),

  ('ALTRI COSTI FISSI', 2, '6202000006', 'Consultores de produccion'),
  ('ALTRI COSTI FISSI', 2, '6302000045', 'INGENIERIA'),
  ('ALTRI COSTI FISSI', 2, '6204000004', 'HSE'),
  ('ALTRI COSTI FISSI', 2, '6205000004', 'EQUIPO RENTADO (montac-gruas)'),
  ('ALTRI COSTI FISSI', 2, '6302000002', 'IT'),
  ('ALTRI COSTI FISSI', 2, '6302000006', 'Consultores administrativo'),
  ('ALTRI COSTI FISSI', 2, '6302000016', 'LIMPRO'),
  ('ALTRI COSTI FISSI', 2, '6302000017', 'IT'),
  ('ALTRI COSTI FISSI', 2, '6302000018', 'Seguro de activos'),
  ('ALTRI COSTI FISSI', 2, '6302000019', 'Administrativos'),
  ('ALTRI COSTI FISSI', 2, '6302000026', 'SEGURIDAD PATRIMONIAL'),
  ('ALTRI COSTI FISSI', 2, '6302000031', 'IT'),
  ('ALTRI COSTI FISSI', 2, '6302000032', 'Consultores administrativo'),
  ('ALTRI COSTI FISSI', 2, '6302000035', 'Consultores administrativo'),
  ('ALTRI COSTI FISSI', 2, '6302000044', 'Es el Managmen Fee de finproject, tecnodata (uso de infinity)'),
  ('ALTRI COSTI FISSI', 2, '6302000046', 'IT'),
  ('ALTRI COSTI FISSI', 2, '6402000003', 'Venta'),
  ('ALTRI COSTI FISSI', 2, '6402000011', 'GASOLINA AUTO'),
  ('ALTRI COSTI FISSI', 2, '6403000007', 'LOGISTICA'),
  ('ALTRI COSTI FISSI', 2, '6403000008', 'LOGISTICA'),
  ('ALTRI COSTI FISSI', 2, '6403000012', 'VENTA'),
  ('ALTRI COSTI FISSI', 2, '6403000014', 'VENTA')
ON CONFLICT (grupo, codigo) DO NOTHING;

COMMIT;
