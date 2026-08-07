# Series Raqui

Biblioteca personal de series y películas con metadatos de TMDB. La aplicación web
y el worker de sincronización comparten SQLite y las mismas reglas de dominio; la
CLI habla con ellos por HTTP.

La especificación completa está en [PLAN.md](./PLAN.md).

## Requisitos

- Bun
- Un token de lectura de TMDB

## Configuración

1. Copia `.env.example` a `.env`.
2. Completa `TMDB_ACCESS_TOKEN`, `APP_PASSWORD` y, si vas a usar la CLI, `API_TOKEN`.
3. Ejecuta `bun install`.
4. Ejecuta `bun run db:migrate`.
5. Arranca la web con `bun run dev`.

Para cargar una Obra de demostración sin consultar TMDB: `bun run db:seed`.

## Variables de entorno

| Variable | Obligatoria | Para qué sirve |
| --- | --- | --- |
| `TMDB_ACCESS_TOKEN` | sí, para buscar y sincronizar | Token de lectura de TMDB. La web arranca sin él, pero buscar, añadir y sincronizar fallan. |
| `APP_PASSWORD` | sí | Contraseña compartida de la web. Sin ella la aplicación no arranca, para que no quede abierta por descuido. |
| `DATABASE_PATH` | no | Fichero SQLite. Por defecto `.data/series-raqui.sqlite`; relativo se resuelve desde la raíz del workspace. La imagen Docker lo fija a `/data/series-raqui.sqlite`. |
| `PORT` | no | Puerto del servidor. Por defecto 3000; en Railway lo inyecta la plataforma. |
| `SESSION_SECRET` | no | Clave de sellado de la cookie. Si falta, se deriva de `APP_PASSWORD`. |
| `API_TOKEN` | no | Token de la API que usa la CLI. Vacío deja `/api` apagada (404). |
| `TZ` | no | Zona horaria del servidor. Sin ella el SSR pinta fechas en UTC y el navegador en local. |

## CLI y API

La CLI no toca SQLite: habla por HTTP con la instancia desplegada, así que sirve
igual contra local que contra Railway. Necesita dos variables:

```text
SERIES_API_URL   por defecto http://localhost:3000
API_TOKEN        el mismo valor que tenga el servicio
```

```text
bun run series -- status
bun run series -- list --status completed
bun run series -- search "Severance"
bun run series -- add --tmdb tv:95396
bun run series -- advance --entry <id>          # alias: next
bun run series -- transition --entry <id> --to watched
bun run series -- edit-entry --entry <id> --locations Casa --platforms AppleTV
bun run series -- abandon --entry <id> --reason "..."
bun run series -- discard --work <id> --reason "..."
bun run series -- sync-all
```

`sync-all` lanza el worker en el servidor y espera, mostrando progreso, hasta que
termina; sale con código distinto de cero si el job no acaba en `completed`, que
es lo que necesita un cron. Con `--no-wait` devuelve el job y termina. Si el
worker muriese, deja de esperar a la media hora en vez de colgarse.

Todos aceptan `--json`, que es como los usan los agentes. El flujo pensado para
eso es: `list --status completed --json` para ver qué se ha visto ya, `search`
para sacar el id de TMDB de cada candidata y `add --tmdb` una por una.

Detrás hay una API mínima bajo `/api`, sólo con lo que la CLI necesita:

```text
GET   /api/status                      recuento por categoría y grupos accionables
GET   /api/works?status=<estado>       biblioteca, filtrable por estado
GET   /api/search?q=<texto>            búsqueda en TMDB
POST  /api/works                       {tmdbType, tmdbId}
POST  /api/works/<id>/discard          {reason}
POST  /api/entries/<id>/advance        pasa la Entrega al siguiente estado
POST  /api/entries/<id>/transition     {target, reason?, force?, watchedAt?}
PATCH /api/entries/<id>                {locations?, platforms?, availability?}
POST  /api/jobs/sync-all               lanza la sincronización, devuelve el job
GET   /api/jobs/active                 el job en curso, o null
GET   /api/jobs/<id>                   job y detalle por Obra, para ir sondeando
```

Abandonar no tiene endpoint propio porque es una transición más (`target:
"abandoned"`), igual que en el dominio. `validate` sigue sin estar en la API: se
ejecuta desde el contenedor con `railway ssh`.

## Acceso

La web es de contraseña única y compartida: una sola biblioteca, sin usuarios ni
datos por persona. `APP_PASSWORD` es esa contraseña y no tiene valor por defecto,
así que la aplicación no arranca sin ella.

Un middleware de petición (`apps/web/src/start.ts`) corta toda petición que no
traiga sesión: las navegaciones acaban en `/login` y las server functions reciben
un 401, de modo que no hay forma de llamarlas por detrás de la interfaz. La sesión
va en una cookie sellada `HttpOnly`, `SameSite=Lax`, con `Secure` cuando la
petición llega por HTTPS, y caduca a los 30 días. Tras 8 intentos fallidos desde
la misma IP el login queda bloqueado 5 minutos.

`SESSION_SECRET` es opcional. Si no se define, la clave de sellado se deriva de
`APP_PASSWORD`, con lo que cambiar la contraseña cierra las sesiones abiertas.

La API va aparte, por `Authorization: Bearer $API_TOKEN`, y no acepta la cookie de
sesión. Un Bearer no lo manda el navegador por su cuenta, así que la API no
necesita protección CSRF y la CLI no tiene que fingir una sesión. Sin `API_TOKEN`
configurado, `/api` responde 404: apagada por defecto, no abierta.

## Jobs

Desde la web se crea un registro en SQLite y se lanza un proceso Bun puntual con el `jobId`. No existe ningún daemon ni worker persistente. SQLite impide dos sincronizaciones simultáneas y conserva progreso, heartbeat, cancelación y resultados.

`POST /api/jobs/sync-all` hace lo mismo desde la CLI: el worker sigue naciendo en
el servidor, no en la máquina que lanza el comando. Un reinicio del contenedor se
lleva por delante el worker en curso y el job se queda en `running` hasta que el
siguiente intento lo marca interrumpido, pasados los 120 s de heartbeat.

El worker y la web escriben el mismo fichero a la vez sin estorbarse porque
`openDatabase` activa WAL y un `busy_timeout` de 5 s.

## Datos

- SQLite: `.data/series-raqui.sqlite` en local, `/data/series-raqui.sqlite` en Railway.
- Carátulas: URLs de TMDB, sin copias locales.
- Temporadas: se incorporan desde la emisión del primer episodio.
- Películas: siempre independientes; no se modelan sagas o spin-offs.

## Despliegue

Está en Railway, en un único servicio construido con el [Dockerfile](./Dockerfile)
del repositorio.

La imagen es multietapa a propósito. La etapa de build instala las
devDependencies para compilar con Vite; la final hace `bun install --production`
y sólo copia `dist`. En una sola etapa la imagen ocupa 1,06 GB (biome, typescript
y el paquete npm `bun` con sus binarios de todas las plataformas); en dos, 333 MB.
Eso además arregla un detalle sutil: `bun` está como devDependency, así que en la
imagen completa el binario de npm eclipsaba al de la imagen base y se ejecutaba
una versión de Bun distinta de la fijada en el `FROM`.

El código fuente se queda en la imagen a propósito: los jobs lanzan
`apps/worker/src/sync-all.ts` con Bun, y los packages del workspace se resuelven
por symlink a sus `.ts`.

Qué hay que configurar en el servicio:

- Un volumen montado en `/data`. El Dockerfile ya apunta `DATABASE_PATH` ahí, así
  que sólo hace falta cambiarla si montas el volumen en otro sitio. Sin volumen,
  la biblioteca se pierde en cada despliegue.
- Variables `APP_PASSWORD`, `TMDB_ACCESS_TOKEN` y, para la CLI, `API_TOKEN`.
  Opcionalmente `SESSION_SECRET` y `TZ=Europe/Madrid`.
- El healthcheck, si lo usas, apuntando a `/login`: `/` responde 303 al no traer
  sesión.

Un volumen fija el servicio a una sola réplica, que es justo lo que hace falta:
SQLite tiene un único escritor y la tabla `jobs` da por hecho una sola máquina.

Las migraciones se ejecutan al arrancar el contenedor, antes de servir, para
fallar pronto si la base no está donde debe.

Para tareas puntuales contra la instancia desplegada (`validate`, inspeccionar la
base) se entra con `railway ssh` y se ejecuta la CLI local del contenedor:

```text
railway ssh
bun apps/cli/src/db.ts status
```

Dentro del contenedor hay que llamar a los scripts directamente y no con
`bun run …`: los del root pasan por `dotenvx` y allí no existe ningún `.env`,
porque las variables las inyecta Railway.

Las copias de seguridad no están automatizadas: un volumen de Railway no tiene
snapshots y la biblioteca entera es un único fichero.

## Verificación

```text
bun run typecheck
bun test
bun run build
```
