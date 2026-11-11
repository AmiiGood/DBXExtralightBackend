# Arranque automático del DBX en Windows

Con esto el DBX arranca solo cuando se enciende el servidor, aunque nadie inicie
sesión. Si se va la luz, al regresar levanta solo. Si el backend o el frontend se
caen, se vuelven a levantar a los 15 segundos. Ya no hace falta dejar consolas
abiertas.

Todo está en `deploy\windows\`, dentro de la carpeta del backend.

## Qué instala

El instalador crea tres tareas en el Programador de tareas. Corren como
**SYSTEM** o, con `-Usuario`, con la cuenta que le digas (ver "Carpetas
compartidas de la red"):

| Tarea | Qué hace | Log |
|---|---|---|
| `DBX - backend` | `node server.js` al encender el equipo | `logs\backend.log` |
| `DBX - frontend` | sirve el frontend compilado (`dist`) con `vite preview`, en el mismo puerto de siempre (5173) | `logs\frontend.log` |
| `DBX - reinicio semanal` | reinicia los dos los domingos a las 04:00 | — |

- Los dos logs quedan en la carpeta `logs` del backend.
- Cuando un log pasa de 20 MB, en el siguiente arranque se guarda como `.anterior` y se empieza uno nuevo.
- El reinicio semanal sirve para que eso pase aunque nunca se apague el equipo.

**Cambio importante:** el frontend ya no corre con `npm run dev`. Ahora se sirve
**compilado**: carga más rápido y no recompila mientras la gente lo usa. Eso
también significa que un cambio en el frontend no se ve hasta compilar otra vez.
`actualizar.ps1` hace esa compilación (ver abajo).

## Instalar (una sola vez)

1. **Cierra las consolas** donde se levantaba el DBX a mano. Si alguna sigue
   abierta, el instalador lo detecta y dice cuál es. Con `-Forzar` las cierra él.
2. Abre **PowerShell como administrador** en la carpeta del backend y corre:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1
```

Qué hace:

- Busca el frontend en la carpeta de al lado (`..\DBXExtralightFrontend`). Si está en otro lado, agrega `-Frontend D:\ruta\DBXExtralightFrontend`.
- Toma el puerto del backend del `PORT=` del `.env`.
- Usa el puerto 5173 para el frontend. Si usan otro, agrega `-PuertoFrontend 8080`.
- Instala las dependencias si faltan, compila el frontend, registra las tareas, arranca todo y revisa que los dos respondan.

3. **Prueba de verdad:** reinicia el servidor y **no inicies sesión**. Desde
   otra computadora abre el DBX. Debe cargar en uno o dos minutos.

## Carpetas compartidas de la red (Customer Service, CAPEX, AIMS)

Si en la pantalla de archivos sale *Sin permiso para leer
"\\172.16.101.124\AREAS\..."* aunque tú sí puedas abrir la carpeta, es por
la cuenta con la que corre el DBX. **SYSTEM** no entra a la red como una
persona, sino como la cuenta del equipo, y esa cuenta no tiene permiso en el
recurso compartido. Antes, con las consolas abiertas, el backend corría con
tu sesión y usaba tus permisos.

Para arreglarlo, vuelve a instalar con una cuenta que sí lea esas carpetas:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1 -Usuario DOMINIO\usuario -ProbarRuta "\\172.16.101.124\AREAS\Customer Service\Metricos Clientes"
```

- Te pide la contraseña de esa cuenta **una vez**. La guarda el Programador de
  tareas (cifrada), y así el DBX arranca al encender el equipo sin que nadie
  inicie sesión.
- Antes de tocar nada, prueba que la contraseña sea correcta. Con
  `-ProbarRuta`, también prueba que esa cuenta pueda leer la carpeta. Si algo
  falla, se detiene y el DBX sigue como estaba.
- Si es una cuenta local del servidor, se escribe `NOMBRE-DEL-SERVIDOR\usuario`.
- La cuenta debe poder escribir en las carpetas del DBX, por los logs y la
  compilación. Lo más fácil es que sea administradora del servidor.
- **Si la contraseña de esa cuenta cambia o vence**, el DBX ya no arranca.
  Vuelve a correr el mismo comando con la contraseña nueva. Conviene usar una
  cuenta de servicio cuya contraseña no venza, no la personal de alguien.

La otra opción es que TI le dé permiso de lectura en el recurso compartido a
la cuenta del equipo (`DOMINIO\NOMBRE-DEL-SERVIDOR$`). Esa opción solo sirve
si el servidor está en el dominio.

**Usa rutas de red, no letras de unidad.** Una tarea programada no ve las
unidades mapeadas (`F:\`, `Z:\`), aunque tú las veas en tu sesión. En las
pantallas de archivos de CAPEX, AIMS y Customer Service la carpeta debe ser
`\\172.16.101.124\AREAS\...`, no `F:\...`.

## Además del software (si no, el equipo ni siquiera prende)

- **BIOS:** pon la opción *Restore on AC Power Loss* (o *After Power Failure*) en
  **Power On**. Si no, al regresar la luz el servidor se queda apagado.
- **PostgreSQL:** en `services.msc`, el servicio de PostgreSQL debe estar en
  inicio **Automático**. El backend lo espera: si arranca antes que la base, se
  cae y a los 15 segundos lo vuelve a intentar, hasta que la base responda.
- **UPS:** evita que un apagón corte la base a media escritura.

## Día a día

| Qué | Cómo (PowerShell como administrador, en la carpeta del backend) |
|---|---|
| Traer una versión nueva | `powershell -ExecutionPolicy Bypass -File deploy\windows\actualizar.ps1` |
| Reiniciar | `powershell -ExecutionPolicy Bypass -File deploy\windows\reiniciar.ps1` |
| Detener (hasta reiniciar o encender) | `... reiniciar.ps1 -Detener` |
| Ver qué pasó | `logs\backend.log` y `logs\frontend.log` |
| Quitar el arranque automático | `... instalar.ps1 -Quitar` (después se puede levantar a mano como antes) |

`actualizar.ps1` hace esto:

1. `git pull` en el backend y en el frontend.
2. `npm ci` si cambiaron las dependencias.
3. Compila el frontend.
4. Reinicia los dos.

Si el pull trae **migraciones nuevas**, no reinicia: te las lista. Aplícalas
después de respaldar la base, como dice el `DESPLIEGUE_*.md` de cada módulo, y
luego corre `reiniciar.ps1`.

Las tareas también se pueden detener e iniciar desde el Programador de tareas.
Al detener ahí, el `node` puede quedar vivo; `reiniciar.ps1` sí lo cierra.

## Archivos

| Archivo | Para qué |
|---|---|
| `instalar.ps1` | Registra las tareas (o las quita con `-Quitar`). Se puede volver a correr. |
| `iniciar-backend.cmd`, `iniciar-frontend.cmd` | Lo que corre cada tarea: levantan node y, si se cae, lo vuelven a levantar. |
| `reiniciar.ps1`, `actualizar.ps1`, `comun.ps1` | Reiniciar, actualizar y lo que comparten. |
| `node-dir.txt`, `instalacion.json` | Los genera el instalador en cada equipo (no van a git): dónde está Node, la carpeta del frontend, su puerto y la cuenta con la que corre (nunca la contraseña). |

Lo probé en local con tareas de mi usuario. Funcionó:

- arrancar los dos, aun con el espacio en "DBX Extralight";
- matar el backend: volvió solo en 19 segundos;
- detener todo, que no vuelve a levantar;
- rotar el log.

Lo que **no** se pudo probar en local: correr como SYSTEM al encender el equipo,
porque hace falta administrador. Por eso el paso 3 de la instalación (reiniciar
sin iniciar sesión) es obligatorio.
