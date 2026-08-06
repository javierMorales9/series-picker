# Series Raqui

Biblioteca personal de series y películas con metadatos de TMDB, aplicación web y CLI compartiendo SQLite y las mismas reglas de dominio.

La especificación completa está en [PLAN.md](./PLAN.md).

## Requisitos

- Bun
- Un token de lectura de TMDB

## Configuración

1. Copia `.env.example` a `.env`.
2. Completa `TMDB_ACCESS_TOKEN`.
3. Ejecuta `bun install`.
4. Ejecuta `bun run db:migrate`.
5. Arranca la web con `bun run dev`.

Para cargar una Obra de demostración sin consultar TMDB: `bun run db:seed`.

## Comandos CLI

```text
bun run series -- search "Severance"
bun run series -- add --tmdb tv:95396
bun run series -- add --tmdb movie:157336
bun run series -- sync --work <id>
bun run series -- sync-all
bun run series -- next --entry <id>
bun run series -- transition --entry <id> --to watched
bun run series -- edit-entry --entry <id> --locations Casa --platforms AppleTV
bun run series -- abandon --entry <id> --reason "..."
bun run series -- discard --work <id> --reason "..."
bun run series -- jobs active --json
bun run series -- validate
```

Los comandos relevantes aceptan `--json` para su uso por agentes.

## Jobs

`sync-all` se ejecuta en primer plano desde la CLI. Desde la web se crea un registro en SQLite y se lanza un proceso Bun puntual con el `jobId`. No existe ningún daemon ni worker persistente. SQLite impide dos sincronizaciones simultáneas y conserva progreso, heartbeat, cancelación y resultados.

## Datos

- SQLite local: `.data/series-raqui.sqlite`.
- Carátulas: URLs de TMDB, sin copias locales.
- Temporadas: se incorporan desde la emisión del primer episodio.
- Películas: siempre independientes; no se modelan sagas o spin-offs.

## Verificación

```text
bun run typecheck
bun test
bun run build
```

Railway queda aplazado. Cuando se despliegue, el fichero SQLite deberá vivir en un volumen persistente y la aplicación tendrá autenticación.
