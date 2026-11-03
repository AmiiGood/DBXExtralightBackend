# Despliegue — Solicitudes de Compra con aprobación

Pasos para subir a producción el módulo de aprobación de solicitudes de Compra
(propuesta en `DBX Extralight\Propuestas\Propuesta - Aprobacion de solicitudes de Compras.docx`).
Van en orden. Marca cada uno al terminarlo.

> Producción: BD `dbx_ensayo` en `172.16.101.107` (sí, se llama "ensayo" pero es
> la de planta). El osTicket de Compras es **otro** que el de Moldes/TI: base
> `osticketadm`, web `http://172.16.101.107/osticketadm/upload/`.

---

## 1. Antes de tocar nada

- [ ] Respaldo de la BD de producción (`pg_dump`), como el de `Respaldos/`.
- [ ] Avisar a Compras que en el piloto les van a llegar tickets del tema
      **Compras - IT** creados por "API", con el folio `[SC-000123]` al final
      del asunto y la aprobación al pie del mensaje.

## 2. Código

- [ ] Commit y push de backend y frontend. Archivos del módulo:
  - Backend: `migrations/2026-10-02_compras_solicitudes_0{1,2,3}_*.sql` y
    `2026-11-02_compras_solicitudes_04_cotizaciones.sql`,
    `src/models/CompraSolicitud.js`, `src/models/CompraCotizacion.js`, `src/models/CompraReporte.js`,
    `src/controllers/comprasController.js`, `src/controllers/cotizacionesComprasController.js`,
    `src/routes/comprasRoutes.js`, `src/services/comprasArchivos.service.js`,
    `src/services/enviarCompras.service.js`, `src/services/avisosCompras.service.js`,
    `src/services/asignadosCompras.service.js`; cambios en `src/app.js`, `server.js`
    y `.gitignore` (carpeta `storage/`).
  - Frontend: `src/pages/compras/*`, `src/components/compras/*`,
    `src/services/compras.service.js`; cambios en `src/App.jsx`,
    `src/components/layout/Sidebar.jsx` y `src/config/areas.js`.
- [ ] Desplegar backend y frontend como siempre (el frontend lleva `npm run build`).

## 3. Migraciones (en este orden)

En el servidor de producción, desde la carpeta del backend, con el `.env` que
apunta a `dbx_ensayo`. Primero simuladas (validan y se revierten), luego de verdad:

```bash
node scripts/aplicar-migracion.js 2026-10-02_compras_solicitudes_01_schema.sql 2026-10-02_compras_solicitudes_02_envio_osticket.sql 2026-10-02_compras_solicitudes_03_avisos.sql 2026-11-02_compras_solicitudes_04_cotizaciones.sql --simular
node scripts/aplicar-migracion.js 2026-10-02_compras_solicitudes_01_schema.sql 2026-10-02_compras_solicitudes_02_envio_osticket.sql 2026-10-02_compras_solicitudes_03_avisos.sql 2026-11-02_compras_solicitudes_04_cotizaciones.sql
```

| Migración | Qué hace |
|---|---|
| `01_schema` | Tablas de áreas de Compras (los 12 temas de osTicket, **sin gerentes**), solicitudes, archivos y bitácora; columna `areas.compras_area_id`; módulos "Solicitudes de Compra" y "Aprobadores de Compras". Liga por nombre las áreas de DBX `TI`, `Calidad` y `Ensamble` si existen. |
| `02_envio_osticket` | Candado de envío (`enviando_desde`) y ajuste de la restricción de EN_COMPRAS. |
| `03_avisos` | Configuración de avisos (L–V 9:00 y 16:00), bitácora de correos, módulo "Reportes de Compras". |
| `04_cotizaciones` | Estados COTIZADA y ELEGIDA, tablas del comparativo de proveedores (partidas, opciones, precios, fotos), asignado del ticket, monto elegido; módulo "Cotizaciones de Compras". Además acomoda los temas nuevos de osticketadm: agrega 41 Inyección Suela y Almacén, 42 Inyección Crocs, 43 Producción Ensamble y 44 HSE (**sin gerentes**), deja el 15 solo como **Planeación** y pasa a su tema nuevo las áreas de DBX que cargaban al 15 y se reconocen por nombre (ensamble, crocs, suela, HSE). |

Las cuatro son idempotentes: si una falla a la mitad se puede volver a correr.

## 4. Variables del `.env` de producción (backend)

| Variable | Valor | Si falta |
|---|---|---|
| `APP_URL` | Dirección del **frontend** de producción, p. ej. `https://172.16.101.107:5173` | Los enlaces de los correos usan `CORS_ORIGIN`; si tampoco sirve, apuntan a localhost. |
| `OSTICKET_COMPRAS_API_URL` | `http://172.16.101.107/osticketadm/upload/api/http.php/tickets.json` | Las aprobadas **no** pasan a Compras (se quedan "Aprobada"). |
| `OSTICKET_COMPRAS_API_KEY` | La llave del paso 6 | Igual que arriba. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Los del correo real (Microsoft 365) que habilite IT | Sin `SMTP_HOST` los correos van a Ethereal y **no llegan a nadie**. |
| `COMPRAS_ARCHIVOS_DIR` | *(opcional)* carpeta de adjuntos | Usa `storage/compras` junto al backend. |

Las de `OSTICKET_DB_*` ya existen (reportes de Moldes y TI). El usuario `powerbi`
tiene que poder **leer** `osticketadm`: hoy sí puede. Se usa solo para consultas
baratas: evitar duplicados, avisar si el correo de quien pide no está en
osTicket y, cada 5 minutos, leer a quién está asignado cada ticket vivo y en qué
estado va (`ost_ticket`, `ost_staff`, `ost_ticket_status`, por llave primaria).

## 5. Carpeta de adjuntos

- [ ] Que exista y que el usuario que corre el backend pueda escribir en ella.
- [ ] **Agregarla al respaldo.** Los archivos no están en la BD, solo sus datos.
      Son unos ~1 GB al año al ritmo actual de Compras.

## 6. osTicket de Compras (alguien con acceso de administrador)

- [ ] Admin Panel → Manage → API Keys → Add New API Key.
  - IP: la del **servidor del backend de DBX** (la llave solo sirve desde esa IP).
  - Marcar "Can Create Tickets".
  - Copiar la llave a `OSTICKET_COMPRAS_API_KEY`.
- [ ] Revisar que PHP acepte el tamaño de los adjuntos: `post_max_size` de 40 MB
      o más en el `php.ini` de `C:\xampp2` (DBX limita a 25 MB por solicitud, que
      en base64 son ~34 MB).

## 7. Reiniciar el backend y revisar el arranque

En el log deben salir estas dos líneas:

```
🕒 Compras: reintento de envíos a osTicket cada 5 min
🕒 Compras: recordatorios lunes a viernes a las 09:00 y 16:00
```

Si sale `sin OSTICKET_COMPRAS_API_URL/KEY`, falta el paso 4 o el 6.

## 8. Configuración en la aplicación (como administrador)

- [ ] **Aprobadores de Compras**
  - Gerente (y suplente si hay) de **Sistemas (TI)** para el piloto. Las demás
    áreas se quedan sin gerente: así no pueden pedir todavía.
  - En "Áreas de DBX", que el área TI apunte a **Sistemas (TI)**.
  - "Envío a Compras" debe decir la dirección de osTicket, no "Sin conexión".
  - "Avisos por correo" → **Mandarme una prueba** y confirmar que llega.
- [ ] **Permisos de roles** (Gestión de Usuarios → permisos del rol):
  - "Solicitudes de Compra": leer + crear, para los roles de quienes **piden** y
    de quienes **aprueban**. Si el rol del gerente no lo tiene, no ve su bandeja;
    la pantalla de Aprobadores lo avisa.
  - "Reportes de Compras": a quien deba ver los tiempos.
  - "Aprobadores de Compras": solo administradores.
  - "Cotizaciones de Compras", para los **agentes de Compras**:
    - **leer** = ve los tickets que tiene asignados en osTicket;
    - **crear** = puede capturar y mandar opciones de proveedores;
    - **editar** = ve y cotiza **todos** (para el jefe de Compras, Orlando).
- [ ] **Usuarios**: cada quien con su **usuario propio** y su correo real
      `@foamcreations.mx`. A ese correo contesta Compras desde osTicket. Si el
      correo no existe en osTicket, la pantalla de nueva solicitud lo avisa.
- [ ] **Agentes de Compras**: un usuario de DBX por agente, con el **mismo correo
      que tiene en osTicket** (es lo que los cruza; p. ej. Leila Muñoz es
      `becario.compras@foamcreations.mx`). Hoy hay 11 agentes activos en
      osticketadm. Mientras alguno no tenga usuario, el jefe ve sus tickets
      marcados "Sin usuario en el DBX" y puede cotizarlos él.
- [ ] **Temas nuevos**: en Aprobadores, asignar gerente a Inyección Suela y
      Almacén, Inyección Crocs, Producción Ensamble, HSE y Planeación, y revisar
      que cada área de DBX apunte al tema correcto (la migración solo movió las que
      reconoció por nombre).

## 9. Prueba del piloto

- [ ] Un usuario de TI pide algo pequeño con una imagen adjunta.
- [ ] Le llega el aviso al gerente; aprueba desde el enlace del correo.
- [ ] Aparece en osTicket de Compras, tema **Compras - IT**, con la imagen y la
      aprobación al pie; Compras recibe su alerta de siempre.
- [ ] A quien pidió le llega "ya está en Compras (ticket AD-…)".
- [ ] Probar también un rechazo: llega el motivo.
- [ ] En **Cotizaciones de Compras**, el agente asignado ve el ticket en "Por
      cotizar" (a más tardar 5 minutos después de crearse, o al abrir la bandeja).
      Captura dos o tres proveedores con foto y lo manda.
- [ ] A quien pidió le llega "Elige proveedor"; en Solicitudes de Compra ve el
      comparativo y elige. Al agente le llega "ya eligieron" con el monto.
- [ ] Probar "Ninguna me sirve": la solicitud regresa a "Por cotizar" del agente
      con el motivo.

> El monto elegido se queda en el DBX. La API de osTicket solo crea tickets, no
> los modifica, así que el ticket no se actualiza solo: Compras sigue moviendo su
> estado ("Cotización entregada", "PO colocada") en osTicket como hoy, y el DBX lo
> muestra.

## 10. Ampliar a las demás áreas

Por cada área: asignar gerente/suplente, ligar sus áreas de DBX y dar el permiso
al rol. Cuando el área ya pida por DBX, que **todas** sus solicitudes pasen por
aquí ("un solo camino" de la propuesta).

> Pendiente de confirmar antes de cerrar el camino directo: si se hace **privado**
> el tema en osTicket para que nadie lo elija desde la web, probar primero que la
> API siga pudiendo crear tickets en ese tema.

## Si hay que dar marcha atrás

Apagar los módulos sin borrar nada:

```sql
UPDATE modulos SET activo = false
 WHERE ruta IN ('/compras/solicitudes', '/compras/aprobadores', '/compras/reportes', '/compras/cotizaciones');
```

Y quitar `OSTICKET_COMPRAS_API_KEY` del `.env` para que no se manden más
tickets. Las solicitudes y la bitácora se quedan en la BD.
