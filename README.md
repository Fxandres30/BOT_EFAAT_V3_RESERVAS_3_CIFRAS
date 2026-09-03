# EFAAT_V3

Proyecto unico con dos carpetas madre:

```
EFAAT_V3/
├── backend/     API Express + bot de WhatsApp (Baileys) + Supabase + IA
├── frontend/    Panel Next.js
├── package.json Orquestador raiz
├── .gitignore
└── README.md
```

## Requisitos

- Node.js
- Variables de entorno configuradas en `backend/.env` y `frontend/.env.local` (no se versionan)

## Instalacion

Instalar dependencias en cada parte del proyecto:

```bash
npm install --prefix backend
npm install --prefix frontend
npm install
```

## Ejecucion

Desde la raiz del proyecto (`EFAAT_V3/`):

```bash
npm run backend    # inicia solo el backend (node server.js, puerto 4000)
npm run frontend   # inicia solo el frontend (next dev)
npm run dev        # inicia backend + frontend en paralelo (concurrently)
```

## Estructura interna

### backend/

- `server.js` / `index.js` — arranque de la API Express y del bot
- `bot/` — logica del bot (handlers, eventos, funciones, workers, IA)
- `services/` — integracion con Baileys (WhatsApp)
- `lib/` — cliente Supabase
- `routes/` — rutas Express
- `auth/` — credenciales de sesiones de WhatsApp (sensible, no se versiona)

### frontend/

- `app/` — App Router de Next.js
- `components/`, `hooks/`, `lib/`, `services/`, `public/`

## Comunicacion

```
frontend  →  HTTP/API  →  backend  →  services/bot  →  Supabase / WhatsApp
```

El frontend no contiene claves privadas de Supabase ni credenciales de Baileys; toda operacion sensible pasa por el backend.
