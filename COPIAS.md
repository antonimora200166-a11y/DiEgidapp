# Copias de seguridad de la base

Cada noche a las **2:00 a. m.** GitHub saca una copia de la base de Supabase, la **cifra** y la guarda **90 días**. La copia trae todo el SGI (catálogo, kardex, documentos, bitácora) y los usuarios de la app. Las contraseñas de los usuarios van protegidas, y por eso la copia va cifrada.

Si una copia falla, GitHub te avisa por correo.

## Activarla (una sola vez)

En GitHub, abre el repositorio **DiEgidapp** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Crea estos dos:

| Nombre (exacto) | Valor |
|---|---|
| `DATABASE_URL` | La misma línea `DATABASE_URL=` de `web/.env.local`, **sin** el `DATABASE_URL=` del principio. |
| `COPIA_CLAVE` | Una frase larga que inventes (mínimo 12 caracteres), por ejemplo `tosca bistro cali copia 2026`. |

**Guarda `COPIA_CLAVE` aparte**, por ejemplo en tu gestor de contraseñas o escrita en un lugar seguro. Sin ella las copias no se pueden abrir, ni siquiera tú.

Luego saca la primera copia a mano para comprobar que funciona: **Actions** → **Copia diaria de la base** → **Run workflow** → **Run workflow**. En 2 o 3 minutos aparece con un ✔ verde. Al abrirla ves un resumen (productos, genéricos, movimientos, usuarios) y, abajo, en **Artifacts**, el archivo cifrado.

## Ver las copias

**Actions** → **Copia diaria de la base**: hay una ejecución por día. Cada una guarda su archivo durante 90 días.

## Restaurar (si algún día pasa algo)

La restauración **nunca se hace sobre la base en uso**: va a un proyecto nuevo, y después se conecta la app a ese proyecto.

1. En Supabase, crea un **proyecto nuevo** y vacío (misma región).
2. En GitHub, crea el secreto `DESTINO_URL` con la cadena del proyecto nuevo (botón **Connect** → **Session pooler**, con su contraseña).
3. Abre la copia que quieres restaurar (**Actions** → **Copia diaria de la base** → la del día) y copia el número largo que aparece al final de la dirección del navegador: `…/actions/runs/`**`12345678901`**.
4. **Actions** → **Restaurar una copia** → **Run workflow**: pega ese número, escribe `RESTAURAR` y dale **Run workflow**.
5. Al terminar compara los números de **productos, genéricos, movimientos y usuarios** con el resumen de la copia.
6. Cambia las claves de la app al proyecto nuevo, en `web/.env.local` y en las variables de Vercel. Los usuarios entran con sus mismas contraseñas.

Si el proyecto destino ya tiene el SGI, la tarea se detiene sin tocar nada.

## Recomendación

Una vez al trimestre, prueba restaurar en un proyecto de prueba. Una copia que nunca se ha restaurado no está comprobada.
