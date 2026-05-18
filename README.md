# UCEMA Open — Sistema de Acreditación

Dashboard en tiempo real para acreditación de eventos UCEMA, con sync vía WebSocket entre múltiples dispositivos y persistencia en PostgreSQL.

## Arquitectura

- **Backend**: Node.js + Express + Socket.IO
- **DB**: PostgreSQL (managed por Render)
- **Frontend**: HTML estático (servido por el mismo proceso)
- **Sync**: WebSocket bidireccional → cualquier acción en un iPad se ve en los otros en <1s
- **Log de auditoría**: cada acción (acreditar, quitar, espontáneo) queda registrada con timestamp y device_id

## Deploy en Render (5 minutos)

### Opción A: Blueprint automático (recomendado)

1. Subí este repo a GitHub (privado está bien)
2. En Render → **New +** → **Blueprint**
3. Conectá el repo, Render detecta el `render.yaml` y crea **web service + base PostgreSQL** de una
4. Click en **Apply** → esperás ~3 min al primer deploy
5. Tu app queda en `https://ucema-acreditacion.onrender.com` (el nombre puede variar)

### Opción B: Manual

1. **Crear la base de datos**:
   - New + → PostgreSQL
   - Name: `ucema-acreditacion-db`, Plan: Free
   - Copiar la `Internal Database URL`

2. **Crear el web service**:
   - New + → Web Service → conectar el repo
   - Runtime: Node, Plan: Free
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables:
     - `DATABASE_URL` = la URL del paso 1
     - `NODE_ENV` = `production`
     - `EVENTO_ID` = `ucema_open_mayo_2026`
   - Health check path: `/health`

## Primera vez que abrís la app

1. Entrá a la URL → como no hay inscriptos cargados, te abre el panel admin
2. Click en **⚙** arriba a la derecha si querés volver a entrar después
3. Subí el XLSX con los inscriptos. Columnas detectadas (case-insensitive, soporta acentos):
   - `nombre`, `apellido`, `dni` *(obligatorias)*
   - `colegio`, `canal`, `email`, `telefono` *(opcionales)*
4. Confirmá → ya están en la base y disponibles en todos los dispositivos

## El día del evento

- Compartí la URL a las 4+ personas que van a acreditar (cada iPad tiene su propio `device_id` automático)
- Cualquier acción se refleja en tiempo real en todos los dispositivos
- Si un iPad pierde wifi un rato, al volver se reconecta solo (Socket.IO) y se sincroniza
- El botón **Finalizar → PDF** genera el reporte con asistentes, no asistentes y espontáneos para descargar

## Notas importantes

- **Plan Free de Render**: el servicio se "duerme" tras 15 min sin tráfico → el primer request post-sueño tarda ~30s. Para evitarlo el día del evento, plan **Starter** ($7/mes) que se queda siempre despierto. La base de datos free no se duerme.
- **Postgres Free**: caduca a los 90 días de creada. Para producción permanente, pasar a `Starter` ($7/mes) o exportar y recrear.
- El `device_id` se guarda en `localStorage` del navegador — es persistente por dispositivo, sirve para saber qué iPad acreditó cada persona en el log de auditoría.

## Estructura

```
.
├── package.json
├── render.yaml          ← Blueprint de Render
├── src/
│   ├── server.js        ← Express + Socket.IO
│   ├── db.js            ← Pool de Postgres
│   └── schema.sql       ← DDL (tablas + índices)
└── public/
    └── index.html       ← Frontend (servido como estático)
```

## Endpoints

| Método | Path | Descripción |
|--------|------|-------------|
| GET | `/api/state` | Estado completo (inscriptos + acreditados + espontáneos) |
| POST | `/api/accredit` | Acreditar un DNI: `{ dni, acompaniantes, device_id }` |
| POST | `/api/deaccredit` | Quitar acreditación: `{ dni, device_id }` |
| POST | `/api/espontaneo` | Agregar espontáneo |
| DELETE | `/api/espontaneo/:id` | Quitar espontáneo |
| POST | `/api/upload-attendees` | Subir XLSX (multipart: `file`, `replace`) |
| GET | `/api/audit?limit=200` | Últimas N acciones del log |
| GET | `/health` | Healthcheck |
| WS | `/socket.io` | Canal de tiempo real, emite `state:update` |

## Desarrollo local

```bash
# Tener Postgres corriendo localmente, o usar Docker:
docker run --name pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
docker exec -it pg createdb -U postgres ucema_acreditacion

npm install
npm start
# → http://localhost:3000
```
