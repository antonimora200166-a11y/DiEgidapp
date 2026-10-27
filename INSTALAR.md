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

Aplica las migraciones y carga el histórico de bar, el de cocina, el catálogo unificado y las compras históricas línea a línea (referencia de precio para la recepción). Al final dice cuántos genéricos, productos, provisionales y pares por revisar quedaron. Si se corta, se puede volver a correr: retoma donde iba.

## 4. Crear el primer administrador

```bash
npm --prefix web install
```

```bash
npm --prefix web run crear-usuario -- anthony "Anthony Mora" admin
```

Pide la contraseña en la terminal. El resto del equipo se crea desde la app, en **Usuarios**.

## 5. Publicar la app (para usarla en celulares y iPad)

1. Entra a [vercel.com](https://vercel.com) con **Continue with GitHub** (la misma cuenta del repositorio).
2. **Add New → Project** → busca `DiEgidapp` → **Import**. Si no aparece: **Adjust GitHub App Permissions** y dale acceso a ese repositorio.
3. En **Root Directory** toca **Edit** y elige la carpeta `web`. El Framework se detecta solo (Next.js).
4. Abre **Environment Variables**. Abre `web/.env.produccion` con el Bloc de notas, copia todo y pégalo en el primer campo (Vercel separa las 4 variables solo). Ahí **no** va `DATABASE_URL`.
5. **Deploy**. En uno o dos minutos te da la dirección (algo como `di-egidapp.vercel.app`).
6. En Supabase → **Authentication → URL Configuration** → **Site URL**: pega esa dirección y guarda.

Cada `git push` a `main` vuelve a publicar solo.

Para instalarla en el equipo: en iPhone/iPad, Safari → Compartir → **Agregar a inicio**; en Android, Chrome → menú → **Instalar app**.

## Para probar en el computador sin publicar

```bash
npm --prefix web run dev
```

y abre http://localhost:3000.
