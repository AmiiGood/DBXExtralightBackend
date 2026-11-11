-- ============================================================================
-- SOLICITUDES DE COMPRA — Etapa 7: tablero para Dirección
--
-- Un tablero solo de consulta (gasto, presupuesto, por mes, por tipo y las
-- compras más grandes) para Dirección (Celina y Stefano). Es un módulo aparte
-- a propósito: se les da permiso a este sin darles la captura de formatos ni
-- las cotizaciones.
--
-- Mientras se usa el formato en papel, el gasto sale de compras_formatos. No
-- crea tablas.
--
-- Idempotente.
-- ============================================================================

BEGIN;

INSERT INTO public.modulos (nombre, descripcion, icono, ruta, activo, orden)
SELECT 'Tablero de Compras',
       'Gasto autorizado contra presupuesto, por área, mes y tipo, para Dirección (solo consulta)',
       'BarChart3',
       '/compras/tablero',
       true,
       29
WHERE NOT EXISTS (SELECT 1 FROM public.modulos WHERE ruta = '/compras/tablero');

COMMIT;
