# Notas para agentes

Biblioteca personal de series y películas. Monorepo Bun con web (TanStack Start),
worker de sincronización y CLI. El detalle está en [README.md](./README.md) y la
especificación en [PLAN.md](./PLAN.md).

## Caso de uso principal

Recomendar obras nuevas y darlas de alta. El flujo es:

1. `series list --status completed --json` y `series list --json` para ver qué se
   ha visto ya. **Empieza siempre por aquí**: sin saber qué hay en la biblioteca
   no se puede recomendar nada parecido, ni evitar proponer algo repetido.
2. Buscar candidatas en internet a partir de eso.
3. Presentárselas y esperar a que elija.
4. `series search "<título>" --json` por cada elegida, para sacar su id de TMDB.
5. `series add --tmdb tv:<id>` o `movie:<id>`, una por una.

En el paso 4 la búsqueda devuelve varios resultados y el primero no siempre es el
bueno: compara nombre, año y tipo antes de quedarte con un id. `add` es un upsert,
así que repetirlo sobre algo ya existente lo actualiza en vez de duplicarlo.

## Usar la CLI

La CLI no toca SQLite: llama por HTTP a la instancia. Necesita dos variables:

```text
SERIES_API_URL   por defecto http://localhost:3000
API_TOKEN        el mismo valor que tenga el servicio
```

Contra local hace falta tener `bun run dev` levantado. Todos los comandos aceptan
`--json`; úsalo siempre, la salida de texto es para personas.

```text
bun run series -- status --json
bun run series -- list [--status <estado>] --json
bun run series -- search "<texto>" --json
bun run series -- add --tmdb <tv:id|movie:id> --json
bun run series -- advance --entry <id> --json
bun run series -- transition --entry <id> --to <estado> --json
bun run series -- edit-entry --entry <id> [--locations <csv>] [--platforms <csv>] --json
bun run series -- abandon --entry <id> --reason "..." --json
bun run series -- discard --work <id> --reason "..." --json
bun run series -- sync-all [--no-wait] --json
```

Los ids de Entrega salen de `status --json` (`nextEntryId` de cada Obra) y los de
Obra de `list --json`.

Con `--json`, los errores salen por stderr como `{"error":{"code","message"}}` y
el código de salida es 1. Los `code` son estables: fíate de ellos, no del texto.

## Reglas del dominio que parecen fallos y no lo son

- **Sólo se puede abandonar desde `watching`.** Desde cualquier otro estado da
  `INVALID_ENTRY_TRANSITION` salvo que pases `--force`.
- **No se puede descartar una Obra ya empezada**: `WORK_ALREADY_STARTED`.
- **Las transiciones van de una en una** (`unplanned → selected → ready →
  watching → watched`). Para saltar varias, `transition --to` con `--force`.
- **Sólo puede haber una sincronización activa**: la segunda recibe
  `SYNC_ALREADY_RUNNING` (409). Es una constraint de SQLite, no una comprobación
  previa, así que no hay carrera posible.
- **Las temporadas futuras no existen** hasta que se emite su primer episodio, así
  que una serie en emisión tendrá menos Entregas de las que dice TMDB.

## Antes de dar algo por terminado

```text
bun run typecheck
bun test
bun run build
```

`bun run check` (biome) tiene fallos previos en `packages/domain`,
`packages/application` y `packages/tmdb`. No los arregles de paso: pasa biome sólo
sobre los ficheros que toques.

## Cosas que conviene saber

- **No edites `apps/web/src/routeTree.gen.ts`**: lo regenera el plugin de Vite al
  hacer `dev` o `build`.
- **`bun run series` pasa por `dotenvx`** y lee `.env`. Dentro del contenedor
  desplegado no hay `.env`, así que allí se invoca `bun apps/cli/src/index.ts`.
- **`apps/cli/src/db.ts` es otra cosa**: administración local de la base
  (`migrate`, `status`, `reset`), va directo a SQLite y no pasa por la API.
  `reset` está bloqueado si `NODE_ENV=production`.
- **La autenticación de la web y la de la API son caminos distintos.** La cookie
  de sesión no vale para `/api` y el token no vale para la web. Está hecho a
  posta: mira la sección «Acceso» del README antes de tocarlo.
- **Todo el texto de cara al usuario está en español**, incluidos los mensajes de
  error y los comentarios del código. Sigue esa línea.
