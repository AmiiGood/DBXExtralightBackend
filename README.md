# Backend - Sistema Foam Creations

Backend del sistema web centralizado para Foam Creations, desarrollado con Node.js, Express y PostgreSQL.

## 📋 Requisitos Previos

- Node.js >= 14.0.0
- npm >= 6.0.0
- PostgreSQL >= 12

## 🚀 Instalación

### 1. Clonar el repositorio (o descomprimir)

```bash
cd foam-creations-backend
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto copiando `.env.example`:

```bash
cp .env.example .env
```

Edita el archivo `.env` con tus credenciales:

```env
# Configuración del servidor
NODE_ENV=development
PORT=3000

# Base de datos PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=foam_creations
DB_USER=postgres
DB_PASSWORD=tu_password

# JWT
JWT_SECRET=cambia_esto_por_una_clave_secreta_segura
JWT_EXPIRES_IN=24h

# CORS
CORS_ORIGIN=http://localhost:3000
```

### 4. Configurar la base de datos

Ejecuta el script SQL proporcionado (`foam_creations_schema.sql`) en tu PostgreSQL:

```bash
psql -U postgres -d foam_creations -f foam_creations_schema.sql
```

## 🎯 Uso

### Modo desarrollo (con hot-reload)

```bash
npm run dev
```

### Modo producción

```bash
npm start
```

El servidor se iniciará en `http://localhost:3000`

## 📚 Estructura del Proyecto

```
foam-creations-backend/
├── src/
│   ├── config/          # Configuraciones (DB, etc.)
│   ├── controllers/     # Controladores de las rutas
│   ├── middlewares/     # Middlewares personalizados
│   ├── models/          # Modelos de datos
│   ├── routes/          # Definición de rutas
│   ├── services/        # Lógica de negocio
│   ├── utils/           # Utilidades y helpers
│   ├── validators/      # Validadores de datos
│   └── app.js           # Configuración de Express
├── server.js            # Punto de entrada
├── .env.example         # Ejemplo de variables de entorno
├── .gitignore
├── package.json
└── README.md
```

## 🔐 API Endpoints Disponibles

### Autenticación

#### POST `/api/auth/login`

Login de usuario

**Body:**

```json
{
  "nombreUsuario": "admin",
  "password": "tu_password"
}
```

#### GET `/api/auth/me`

Obtener información del usuario actual

#### POST `/api/auth/change-password`

Cambiar contraseña del usuario actual

#### POST `/api/auth/logout`

Cerrar sesión (registra en logs)

---

### Gestión de Usuarios (Solo Administradores)

#### GET `/api/usuarios`

Listar todos los usuarios

- Query params: `?activo=true&rolId=2&areaId=1`

#### GET `/api/usuarios/:id`

Obtener un usuario por ID

#### POST `/api/usuarios`

Crear un nuevo usuario

**Body:**

```json
{
  "nombreUsuario": "usuario_nuevo",
  "email": "usuario@email.com",
  "password": "password123",
  "nombreCompleto": "Nombre Completo",
  "rolId": 2,
  "areaId": 2
}
```

#### PUT `/api/usuarios/:id`

Actualizar un usuario

#### PATCH `/api/usuarios/:id/activar`

Activar un usuario

#### PATCH `/api/usuarios/:id/desactivar`

Desactivar un usuario

#### POST `/api/usuarios/:id/reset-password`

Resetear contraseña de un usuario

**Body:**

```json
{
  "nuevaPassword": "nueva_password"
}
```

#### GET `/api/usuarios/roles`

Obtener todos los roles disponibles

#### GET `/api/usuarios/areas`

Obtener todas las áreas disponibles

---

📖 **Ver documentación completa:** [API_USUARIOS.md](./API_USUARIOS.md)

### Rutas de Salud

#### GET `/`

Información básica de la API

#### GET `/health`

Health check del servidor

## 🔒 Seguridad

- **Autenticación**: JWT (JSON Web Tokens)
- **Contraseñas**: Hasheadas con bcrypt (12 rounds)
- **Headers de seguridad**: Helmet.js
- **CORS**: Configurado según origen permitido
- **Validación**: express-validator en todas las entradas
- **Logs**: Registro completo de todas las acciones

## 📝 Características Implementadas

### ✅ Fase 1 - Autenticación y Base

- [x] Sistema de autenticación con JWT
- [x] Login/Logout con registro en logs
- [x] Cambio de contraseña
- [x] Middleware de autenticación
- [x] Middleware de autorización por roles
- [x] Sistema de permisos granulares por módulo
- [x] Manejo centralizado de errores
- [x] Logging automático de acciones
- [x] Validación de datos

### ✅ Fase 2 - Gestión de Usuarios (Admin)

- [x] Listar usuarios con filtros (activo, rol, área)
- [x] Crear nuevos usuarios
- [x] Actualizar información de usuarios
- [x] Desactivar/activar usuarios (soft delete)
- [x] Resetear contraseñas
- [x] Obtener catálogos (roles y áreas)
- [x] Validaciones completas
- [x] Logs automáticos de todas las operaciones

#### Fase 3 - Módulo de Calidad

- [ ] Registro de defectos
- [ ] Consulta de registros
- [ ] Reportes y estadísticas
- [ ] Gestión de catálogos (defectos, áreas, etc.)

#### Fase 4 - Reportes y Dashboard

- [ ] Dashboard principal
- [ ] Reportes personalizados
- [ ] Exportación a Excel/PDF
- [ ] Gráficas y métricas

## 🔧 Mantenimiento

### Backup de Base de Datos

```bash
pg_dump -U postgres foam_creations > backup_$(date +%Y%m%d).sql
```

### Restaurar Base de Datos

```bash
psql -U postgres -d foam_creations < backup_20250113.sql
```

## 🐛 Debugging

El servidor registra información detallada en consola:

- En **desarrollo**: logs con `morgan` en formato 'dev'
- En **producción**: logs con `morgan` en formato 'combined'

## 📞 Soporte

Para cualquier duda o problema, contacta al equipo de TI de Foam Creations.

---

## 🔑 Crear Usuario Administrador Inicial

Si aún no tienes un usuario administrador, ejecuta esto en PostgreSQL:

```sql
INSERT INTO usuarios (
    nombre_usuario,
    email,
    password_hash,
    nombre_completo,
    rol_id,
    area_id
)
VALUES (
    'admin',
    'ti@foamcreations.com',
    crypt('Admin2025!', gen_salt('bf')),
    'Administrador TI',
    (SELECT id FROM roles WHERE nombre = 'Administrador'),
    (SELECT id FROM areas WHERE nombre = 'TI')
);
```

**Credenciales por defecto:**

- Usuario: `admin`
- Contraseña: `Admin2025!`

⚠️ **IMPORTANTE**: Cambia esta contraseña inmediatamente después del primer login.

---

**Versión:** 1.0.0  
**Última actualización:** Enero 2025
