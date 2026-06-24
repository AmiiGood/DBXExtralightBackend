# 🚀 Guía de Inicio Rápido - Sistema Centralizado Foam Creations

## ⚠️ Problemas Comunes y Soluciones

### 1. Backend no está corriendo
**Error:** "No se puede conectar al servidor"

**Solución:**
```bash
# En el directorio raíz del proyecto
npm start
# O con nodemon para desarrollo
npm run dev
```

### 2. Error de CORS
**Error:** "Access to XMLHttpRequest blocked by CORS policy"

**Solución:** Crear/actualizar archivo `.env` en la raíz del proyecto:

```bash
# Copiar el ejemplo
cp .env.example .env

# Editar .env y cambiar CORS_ORIGIN:
CORS_ORIGIN=http://localhost:5173
# O para aceptar todos los orígenes en desarrollo:
# CORS_ORIGIN=*
```

### 3. Estilos de Tailwind no se ven
**Solución:** Ya está resuelto con Tailwind CSS v4. Asegúrate de que el servidor de desarrollo esté corriendo.

---

## 📋 Pasos para Iniciar el Proyecto

### Paso 1: Configurar Backend

1. **Crear archivo .env** (si no existe):
```bash
cp .env.example .env
```

2. **Editar .env** con tus configuraciones:
```env
NODE_ENV=development
PORT=3000

# Base de datos
DB_HOST=localhost
DB_PORT=5432
DB_NAME=foam_creations
DB_USER=postgres
DB_PASSWORD=tu_password_aqui

# JWT
JWT_SECRET=cambia_esto_por_una_clave_secreta_segura
JWT_EXPIRES_IN=24h

# CORS - IMPORTANTE: Usar puerto 5173 para Vite
CORS_ORIGIN=http://localhost:5173
```

3. **Instalar dependencias** (si no lo has hecho):
```bash
npm install
```

4. **Iniciar el backend**:
```bash
npm start
# O con auto-reload:
npm run dev
```

El backend estará en: `http://localhost:3000`

---

### Paso 2: Configurar Frontend

1. **Ir al directorio frontend**:
```bash
cd frontend
```

2. **Verificar que existe el archivo .env**:
```bash
cat .env
# Debe mostrar: VITE_API_URL=http://localhost:3000/api
```

3. **Instalar dependencias** (si no lo has hecho):
```bash
npm install
```

4. **Iniciar el frontend**:
```bash
npm run dev
```

El frontend estará en: `http://localhost:5173`

---

## ✅ Verificación

### 1. Verificar que el backend está corriendo:
Abre en tu navegador: http://localhost:3000

Deberías ver:
```json
{
  "status": "success",
  "message": "API de Foam Creations",
  "version": "1.0.0"
}
```

### 2. Verificar que el frontend está corriendo:
Abre en tu navegador: http://localhost:5173

Deberías ver la pantalla de login.

### 3. Verificar la conexión:
Abre la consola del navegador (F12) e intenta hacer login.

Deberías ver en la consola:
```
Intentando login con: { nombreUsuario: "tu_usuario" }
API URL: http://localhost:3000/api
```

---

## 🔑 Credenciales de Prueba

Para crear un usuario administrador, ejecuta este SQL en tu base de datos:

```sql
-- Insertar usuario admin (contraseña: admin123)
INSERT INTO usuarios (nombre_usuario, email, password, nombre_completo, rol_id, area_id, activo)
VALUES (
  'admin',
  'admin@foamcreations.com',
  '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', -- password: admin123
  'Administrador',
  1, -- ID del rol admin
  1, -- ID del área TI
  true
);
```

Luego puedes iniciar sesión con:
- **Usuario:** `admin`
- **Contraseña:** `admin123`

---

## 🐛 Debug de Problemas

### Ver logs del backend
El backend muestra logs en la consola donde lo iniciaste.

### Ver logs del frontend
Abre las DevTools del navegador (F12) y ve a la pestaña "Console".

Allí verás:
- Intentos de login
- Respuestas del servidor
- Errores de conexión

### Error común: "Cannot read properties of null"
Esto significa que el backend no respondió correctamente o no se pudo conectar.

**Verificar:**
1. ¿El backend está corriendo?
2. ¿La URL en `.env` del frontend es correcta?
3. ¿CORS está configurado correctamente en el backend?

---

## 📱 Estructura de Puertos

| Servicio | Puerto | URL |
|----------|--------|-----|
| Backend API | 3000 | http://localhost:3000 |
| Frontend (Vite) | 5173 | http://localhost:5173 |
| PostgreSQL | 5432 | localhost:5432 |

---

## 🔄 Reiniciar Todo

Si algo no funciona, reinicia todo:

```bash
# Terminal 1 - Backend
cd /home/user/dbxXtralightBackendV2
npm run dev

# Terminal 2 - Frontend
cd /home/user/dbxXtralightBackendV2/frontend
npm run dev
```

---

## 📝 Checklist de Verificación

- [ ] Backend está corriendo en puerto 3000
- [ ] Frontend está corriendo en puerto 5173
- [ ] Archivo `.env` del backend existe con CORS_ORIGIN correcto
- [ ] Archivo `.env` del frontend existe con VITE_API_URL correcto
- [ ] Base de datos PostgreSQL está corriendo
- [ ] Tabla de usuarios tiene al menos un usuario activo
- [ ] Consola del navegador no muestra errores de red

---

Si sigues estos pasos y aún tienes problemas, revisa los logs en la consola del navegador para ver el error específico.
