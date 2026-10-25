# Puesta en marcha de SGI Di Égida

Cinco pasos, una sola vez. Después, para actualizar la base basta con `npm run bd:instalar`.

## 1. Crear el proyecto en Supabase

1. En [supabase.com](https://supabase.com) → **New project**. Región: **South America (São Paulo)**. Guarda la contraseña de la base.
2. **Authentication → Sign In / Providers → Email**:
   - apaga **Allow new users to sign up** (solo administración crea usuarios);
   - apaga **Confirm email** (los usuarios no tienen correo real).

## 2. Llenar `web/.env.local`

Copia `web/.env.example` a `web/.env.local` y llena:

| Variable | Dónde está en Supabase |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → `service_role` (secreta) |
| `DATABASE_URL` | Botón **Connect** → **Session pooler**, con la contraseña de la base |

`web/.env.local` nunca se sube a GitHub (está excluido).

## 3. Instalar la base

Desde la carpeta del proyecto:

```bash
npm install
```

```bash
npm run bd:instalar
```

Aplica las 7 migraciones y carga el histórico de bar, el de cocina y el catálogo unificado. Al final dice cuántos genéricos, productos, provisionales y pares por revisar quedaron. Si se corta, se puede volver a correr: retoma donde iba.

## 4. Crear el primer administrador

```bash
npm --prefix web install
```

```bash
npm --prefix web run crear-usuario -- anthony "Anthony Mora" admin
```

Pide la contraseña en la terminal. El resto del equipo se crea desde la app, en **Usuarios**.

## 5. Publicar la app (para usarla en celulares y iPad)

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio `DiEgidapp`.
2. **Root Directory**: `web`.
3. **Environment Variables**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_DOMINIO_USUARIOS` y `SUPABASE_SERVICE_ROLE_KEY`. **No** pongas `DATABASE_URL`.
4. **Deploy**. Cada `git push` a `main` vuelve a publicar.

Para instalarla en el equipo: en iPhone/iPad, Safari → Compartir → **Agregar a inicio**; en Android, Chrome → menú → **Instalar app**.

## Para probar en el computador sin publicar

```bash
npm --prefix web run dev
```

y abre http://localhost:3000.
