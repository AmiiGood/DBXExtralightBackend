# Archivos de SharePoint: alta y despliegue

Los libros de **Compound** (Producción diaria y Powder recovery) e **Inyección**
viven en SharePoint de Finproject. El backend los lee por Microsoft Graph cada
20 minutos y, si cambiaron, los carga con el mismo importador de la pantalla de
carga manual. La configuración (URL de la carpeta y nombre del archivo) está en
**Administración → Archivos de SharePoint** (`/admin/sharepoint`).

El backend entra como **aplicación**, no como una persona. No usa la contraseña
de nadie y no necesita que haya una sesión abierta en el servidor.

---

## 1. Lo que tiene que hacer TI de Finproject (administrador de Entra ID)

### 1.1 Registrar la aplicación

Entra ID → *App registrations* → *New registration*

- Nombre: `DBX Extralight - lectura SharePoint FCMX`
- Tipo de cuenta: *Single tenant*
- Redirect URI: ninguna

Hay que guardar el **Directory (tenant) ID** y el **Application (client) ID**.

### 1.2 Crear el secreto

*Certificates & secrets* → *New client secret*. Guardar el **Value** en ese
momento, porque después ya no se muestra. Hay que anotar cuándo vence: el día
que venza, la pantalla dirá "SharePoint rechazó el acceso de la aplicación".

### 1.3 Permiso: `Sites.Selected` (y solo ese)

*API permissions* → *Add* → *Microsoft Graph* → *Application permissions* →
`Sites.Selected` → *Grant admin consent*.

`Sites.Selected` por sí solo **no da acceso a nada**. Solo permite que en el
paso siguiente se le conceda lectura a sitios concretos. Se pide este permiso y
no `Sites.Read.All` para que la app no pueda leer todo el SharePoint de la
empresa.

### 1.4 Conceder lectura a cada sitio

Esto se hace una vez por cada sitio donde haya archivos (si Compound e
Inyección están en el mismo sitio, es una sola vez). Lo corre un administrador
con Graph Explorer o PowerShell:

```http
GET https://graph.microsoft.com/v1.0/sites/finprojectspa.sharepoint.com:/sites/<NOMBRE_DEL_SITIO>
```

De la respuesta se toma `id` y luego:

```http
POST https://graph.microsoft.com/v1.0/sites/<id>/permissions
Content-Type: application/json

{
  "roles": ["read"],
  "grantedToIdentities": [
    { "application": { "id": "<CLIENT_ID>", "displayName": "DBX Extralight - lectura SharePoint FCMX" } }
  ]
}
```

Con PnP PowerShell se puede hacer en un solo paso:

```powershell
Grant-PnPAzureADAppSitePermission -AppId <CLIENT_ID> -DisplayName "DBX Extralight" -Site https://finprojectspa.sharepoint.com/sites/<NOMBRE_DEL_SITIO> -Permissions Read
```

---

## 2. En el servidor del backend

### 2.1 Salida a internet

El servidor necesita salir por HTTPS (443) a:

- `login.microsoftonline.com`
- `graph.microsoft.com`
- `*.sharepoint.com` (la descarga se redirige ahí)

Si la red sale por proxy, agregar al entorno del proceso (Node 24 lo soporta):

```
NODE_USE_ENV_PROXY=1
HTTPS_PROXY=http://<proxy>:<puerto>
```

### 2.2 `.env`

```
SP_TENANT_ID=<Directory (tenant) ID>
SP_CLIENT_ID=<Application (client) ID>
SP_CLIENT_SECRET=<Value del secreto>
SP_SYNC_MINUTOS=20
SP_REPOSO_MINUTOS=10
```

Sin estas tres primeras variables el backend arranca igual, pero no programa la
revisión y la pantalla avisa que faltan credenciales.

### 2.3 Migraciones

```
node scripts/aplicar-migracion.js 2026-10-21_sharepoint_01_schema.sql 2026-10-21_sharepoint_02_seed.sql
```

Crean `sp_archivos`, `sp_sincronizaciones` y el módulo *Archivos de SharePoint*,
y siembran los tres archivos **sin URL y apagados**.

Después hay que reiniciar el backend.

---

## 3. Dejar funcionando cada archivo

En **Administración → Archivos de SharePoint**, para cada archivo:

1. Abrir la carpeta en el navegador y **copiar la dirección de la barra**. Sirve
   tal cual, incluso si es la vista `.../Forms/AllItems.aspx?id=...`. Un enlace
   de *Compartir* (`/:f:/s/...`) **no sirve**: la pantalla lo avisa.
2. Revisar el nombre del archivo y darle **Guardar**.
3. **Probar**. No baja ni carga nada, solo dice si se alcanza el archivo:
   - *Falta configurar el acceso*: falta el `.env` (paso 2.2).
   - *Microsoft rechazó las credenciales*: el tenant, el client id o el secreto
     están mal.
   - *La aplicación no tiene permiso sobre el sitio*: falta el paso 1.4 para
     ese sitio.
   - *No se encontró "X"*: el nombre está mal. El mensaje enumera los Excel que
     hay en esa carpeta.
4. Cuando la prueba salga bien, marcar **Leer este archivo solo**, Guardar, y
   opcionalmente **Cargar ahora** para no esperar la vuelta.

## Cómo se comporta

- **Solo baja el archivo si cambió.** Compara el hash que publica SharePoint, así
  que una vuelta sin cambios no descarga los ~28 MB de Inyección.
- **Espera a que el archivo deje de cambiar.** Si se guardó hace menos de
  `SP_REPOSO_MINUTOS`, lo deja para la siguiente vuelta. Con el autoguardado de
  Excel, de otro modo se cargaría una captura a medias.
- **Reemplaza igual que la carga manual.** Solo el rango de fechas del archivo y
  solo lo que vino de una importación (`origen = 'IMPORTACION'`). Lo capturado
  por formulario no se toca.
- **Si el importador rechaza el archivo, no lo reintenta** hasta que el
  contenido cambie. El error se queda en la pantalla. *Cargar ahora* lo fuerza.
- La carga manual sigue disponible. Las cargas automáticas aparecen en su
  historial como `<archivo> (SharePoint)`, sin usuario.

## Sumar STAFF o Resultados después

1. Agregar su importador en `IMPORTADORES` de
   `src/services/sincronizarSharePoint.service.js` (los dos ya reciben un Buffer).
2. Agregar su renglón a `sp_archivos` (clave, nombre, importador, archivo).
3. Si están en otro sitio, repetir el paso 1.4 para ese sitio.

Cuidado con STAFF: es un Excel **semanal** y su importador saca el corte del
nombre del archivo. Si cada semana se sube un archivo nuevo con otro nombre, un
nombre fijo no le sirve: habría que leer "el más reciente de la carpeta".
