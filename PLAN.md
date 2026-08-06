# Series Raqui — Plan de implementación

## 1. Objetivo

Construir un sistema personal para registrar series y películas, controlar el progreso de sus temporadas o entregas y sincronizar sus metadatos con TMDB.

El sistema tendrá dos interfaces:

- Una aplicación web para el uso cotidiano.
- Una CLI para Codex/ChatGPT y automatizaciones.

Ambas interfaces compartirán dominio, casos de uso, persistencia y acceso a TMDB.

## 2. Decisiones cerradas

- No se registrarán episodios individuales.
- El dominio tendrá dos entidades principales: `Obra` y `Entrega`.
- Una Obra podrá representar una serie o una película independiente.
- Una Entrega podrá representar una temporada o una película.
- Una película independiente será una Obra con una única Entrega.
- Una serie será una Obra con una Entrega por temporada.
- Cada película se almacenará siempre como una Obra independiente.
- No se modelarán sagas, secuelas, precuelas, spin-offs ni universos compartidos.
- Las relaciones entre películas se consideran conceptualmente similares a las relaciones entre series relacionadas y quedan fuera del dominio.
- TMDB será la única fuente externa de metadatos e identificadores.
- IMDb no se utilizará.
- Las imágenes se servirán mediante URLs de TMDB; no se almacenarán localmente.
- SQLite será la única base de datos.
- En local, SQLite será un fichero dentro de `.data/`.
- Notion queda fuera del sistema.
- SQLite Cloud queda descartado.
- Si se despliega en Railway, se utilizará inicialmente SQLite sobre un volumen persistente.
- El despliegue se decidirá cuando la versión local sea funcional.
- La aplicación web utilizará TanStack Start.
- Bun será runtime, gestor de paquetes y ejecutor de scripts.
- La primera versión se ejecutará en local y no tendrá autenticación.
- Antes de un despliegue público se añadirá autenticación.
- TMDB se consultará en `es-ES`, con fallback al idioma original y a imágenes sin idioma.
- Las carátulas utilizarán `w500` por defecto y permitirán descargar el original.
- Las Entregas futuras no se crearán hasta que se puedan ver.
- No habrá un worker persistente, daemon ni proceso que escanee periódicamente la tabla de jobs.

## 3. Glosario

### Obra

Agrupación completa que aparece en la biblioteca.

Ejemplos:

- `Breaking Bad`: Obra de tipo serie.
- `La Comunidad del Anillo`: Obra independiente de tipo película.
- `Interstellar`: Obra de tipo película.

### Entrega

Unidad mínima cuyo progreso se registra.

Ejemplos:

- `Breaking Bad — Temporada 1`.
- `El Señor de los Anillos — La Comunidad del Anillo`.
- `Interstellar — Interstellar`.

## 4. Arquitectura

```text
Web ─────────┐
             ├──► Casos de uso ──► Dominio
CLI ─────────┘          │
                        ├──► Repositorios SQLite
                        └──► Cliente TMDB
```

Monorepo TypeScript:

```text
series-chat/
├─ apps/
│  ├─ web/                 # TanStack Start
│  ├─ cli/                 # CLI `series`
│  └─ worker/              # Entradas de procesos puntuales
├─ packages/
│  ├─ domain/              # Entidades y reglas puras
│  ├─ application/         # Casos de uso y puertos
│  ├─ database/            # SQLite, repositorios y migraciones
│  ├─ tmdb/                # Cliente y mapeadores de TMDB
│  ├─ jobs/                # Orquestación y progreso
│  └─ config/              # Configuración compartida
├─ tests/
├─ .data/                  # Ignorado por Git
├─ bun.lock
├─ package.json
└─ README.md
```

### 4.1. Dominio

No conocerá SQLite, TMDB, HTTP, TanStack Start, Bun ni la CLI.

Responsabilidades:

- Estados y transiciones.
- Cálculo del Estado de una Obra.
- Selección de Entrega actual.
- Validación de descarte y abandono.
- Validación de agregados.

### 4.2. Application

Casos de uso previstos:

- `searchCatalog`
- `addWork`
- `syncWork`
- `syncAllWorks`
- `transitionEntry`
- `advanceEntry`
- `discardWork`
- `abandonEntry`
- `getDashboard`
- `getWorkDetails`
- `validateLibrary`
- `startJob`
- `getJob`
- `cancelJob`

### 4.3. Infraestructura

- `packages/database` implementará repositorios SQLite.
- `packages/tmdb` implementará búsqueda y sincronización externa.
- `packages/jobs` coordinará la creación, exclusión y progreso de trabajos.
- Web, CLI y worker serán adaptadores finos que llamarán a los mismos casos de uso.

## 5. Persistencia SQLite

### 5.1. Fichero local

Ubicación por defecto:

```text
.data/series-raqui.sqlite
```

Configuración inicial de cada conexión:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Reglas:

- Todas las migraciones estarán versionadas en el repositorio.
- `.data/` estará ignorado por Git.
- Las transacciones serán cortas.
- No se mantendrá una transacción abierta mientras se consulta TMDB.
- Cada Obra sincronizada se aplicará mediante una transacción independiente.

### 5.2. Tabla `works`

Campos previstos:

| Campo | Descripción |
|---|---|
| `id` | UUID/ULID interno |
| `tmdb_type` | `tv` o `movie` |
| `tmdb_id` | Identificador TMDB |
| `type` | `series` o `movie` |
| `name` | Nombre localizado |
| `original_name` | Nombre original |
| `start_year` | Año inicial |
| `poster_path` | Ruta devuelta por TMDB |
| `status` | Estado derivado persistido |
| `current_entry_id` | Entrega actual |
| `discard_reason` | Motivo de descarte |
| `last_synced_at` | Última sincronización correcta |
| `sync_error` | Último error de sincronización |
| `created_at` | Fecha de creación |
| `updated_at` | Fecha de modificación |

Restricción única:

```sql
UNIQUE (tmdb_type, tmdb_id)
```

### 5.3. Tabla `entries`

Campos previstos:

| Campo | Descripción |
|---|---|
| `id` | UUID/ULID interno |
| `work_id` | Obra propietaria |
| `tmdb_id` | ID de temporada o película |
| `type` | `season` o `movie` |
| `name` | Nombre localizado o fallback `Tn` |
| `original_name` | Nombre original |
| `position` | Orden dentro de la Obra |
| `season_number` | Solo para temporadas |
| `release_date` | Fecha de estreno |
| `poster_path` | Ruta de carátula TMDB |
| `status` | Estado de progreso |
| `availability` | Disponibilidad |
| `locations` | JSON con lugares |
| `platforms` | JSON con plataformas |
| `last_watched_at` | Última fecha de visualización |
| `abandonment_reason` | Motivo de abandono |
| `counts_towards_progress` | Excluye especiales |
| `last_synced_at` | Última sincronización |
| `created_at` | Fecha de creación |
| `updated_at` | Fecha de modificación |

Restricción única lógica:

```sql
UNIQUE (work_id, type, tmdb_id)
```

### 5.4. Tabla `jobs`

Campos previstos:

| Campo | Descripción |
|---|---|
| `id` | Identificador del job |
| `type` | Inicialmente `sync_all` |
| `source` | `web` o `cli` |
| `status` | Estado del job |
| `total_items` | Total de Obras |
| `completed_items` | Obras procesadas |
| `changed_items` | Obras modificadas |
| `failed_items` | Obras fallidas |
| `worker_id` | Identificador de la ejecución |
| `worker_pid` | PID informativo |
| `created_at` | Creación |
| `started_at` | Inicio real |
| `heartbeat_at` | Última señal de vida |
| `cancellation_requested_at` | Solicitud de cancelación |
| `finished_at` | Finalización |
| `error` | Error global |

Estados:

```text
pending
running
completed
completed_with_errors
failed
cancelled
interrupted
```

### 5.5. Tabla `job_items`

Registrará el resultado por Obra:

| Campo | Descripción |
|---|---|
| `job_id` | Job propietario |
| `work_id` | Obra procesada |
| `status` | `pending`, `running`, `unchanged`, `changed` o `failed` |
| `changes` | Resumen JSON de cambios |
| `error` | Error específico |
| `started_at` | Inicio |
| `finished_at` | Fin |

Clave primaria compuesta:

```sql
PRIMARY KEY (job_id, work_id)
```

### 5.6. Migraciones

Se mantendrá una tabla `schema_migrations`. Las migraciones se ejecutarán explícitamente antes de arrancar la aplicación o mediante un comando dedicado:

```text
bun run db:migrate
```

En un despliegue futuro con volumen, las migraciones se ejecutarán al iniciar el servicio, cuando el volumen ya esté montado.

## 6. Reglas de dominio

### 6.1. Estados de una Entrega

```text
No planificada -> Seleccionada -> Lista para ver -> Viendo -> Vista
                                              └-> Abandonada
```

Reglas:

1. Solo puede haber una Entrega `Viendo` por Obra.
2. Puede haber varias seleccionadas o listas para ver.
3. Una Entrega no estrenada no se crea todavía.
4. Pasar a `Vista` establece `last_watched_at`.
5. Pasar a `Abandonada` exige motivo.
6. Revertir desde `Vista` requiere una operación forzada explícita.
7. Una transición inválida se rechaza en todas las interfaces.

### 6.2. Estado de una Obra

Precedencia:

1. `Descartada`: decisión manual válida.
2. `Abandonada`: existe una Entrega abandonada.
3. `Viendo`: existe una Entrega en curso.
4. `Seleccionada`: existe una Entrega seleccionada o lista para ver.
5. `Finalizada`: todas las Entregas contabilizables están vistas.
6. `Empezada`: existe alguna vista, quedan pendientes y no hay actividad actual.
7. `No planificada`: ninguno de los casos anteriores.

Reglas adicionales:

- Solo se puede descartar una Obra que nunca se haya empezado.
- Descartar exige motivo.
- Los especiales no afectan al progreso.
- Estado y Entrega actual se recalculan dentro de la misma transacción que modifica una Entrega.

### 6.3. Entrega actual

Prioridad:

1. Entrega abandonada.
2. Entrega en `Viendo`.
3. Menor posición en `Lista para ver`.
4. Menor posición en `Seleccionada`.
5. Entrega vista de mayor posición.
6. Vacío.

### 6.4. Acción `next`

| Estado actual | Estado siguiente |
|---|---|
| No planificada | Seleccionada |
| Seleccionada | Lista para ver |
| Lista para ver | Viendo |
| Viendo | Vista |

Después de marcar una Entrega como Vista, la siguiente pasa a ser la Entrega actual, pero permanece No planificada.

## 7. Integración con TMDB

### 7.1. Datos externos

TMDB administrará:

- IDs.
- Nombres y títulos originales.
- Años y fechas de estreno.
- Orden y números de temporada.
- Poster paths.
- Aparición de nuevas Entregas.

El usuario administrará:

- Estado y progreso.
- Lugar y plataforma.
- Fechas de visualización.
- Motivos de abandono o descarte.

Una sincronización nunca sobrescribirá datos de usuario.

### 7.2. Idioma

- Consultas en `es-ES`.
- Fallback al idioma original para textos no traducidos.
- Preferencia por imágenes españolas.
- Fallback a imagen del idioma original o sin idioma.

### 7.3. Carátulas

- Se guardará `poster_path`, no el fichero.
- URL `w500` por defecto para web.
- La UI podrá solicitar otros tamaños admitidos.
- La descarga `original` pasará por un endpoint del servidor que asigne un nombre legible.
- La web incluirá la atribución exigida por TMDB.

### 7.4. Entregas futuras

- No se crearán temporadas ni películas futuras.
- Una Entrega se importará cuando `release_date <= fecha actual`.
- Para una temporada se utilizará la fecha de emisión inicial proporcionada por TMDB.
- Una temporada se podrá importar desde la emisión de su primer episodio aunque continúe publicándose semanalmente.
- No se registrará automáticamente si una temporada está parcialmente emitida o completa.
- El usuario decidirá manualmente cuándo cambiar una temporada a `Vista`; TMDB nunca realizará esa transición.
- Una Obra permanecerá Finalizada mientras la siguiente temporada no se haya estrenado.
- El primer sync posterior al estreno creará la Entrega y convertirá la Obra en Empezada.

### 7.5. Sincronización idempotente

Para cada Obra:

1. Consultar TMDB fuera de una transacción SQLite.
2. Buscar por `tmdb_type + tmdb_id`.
3. Crear o actualizar metadatos externos de la Obra.
4. Crear únicamente Entregas estrenadas que todavía no existan.
5. Actualizar metadatos externos de Entregas existentes.
6. No modificar datos de progreso.
7. No eliminar automáticamente registros ausentes en TMDB.
8. Recalcular Estado y Entrega actual.
9. Aplicar todos los cambios de esa Obra en una transacción.
10. Registrar fecha o error de sincronización.

Ejecutar repetidamente el sync sin cambios externos producirá el mismo estado.

## 8. Jobs y `sync-all`

### 8.1. Principio

No habrá un worker persistente ni un proceso que busque jobs pendientes.

Un job iniciado desde la web funciona así:

```text
Petición web
   ├─ crea el job en SQLite
   ├─ lanza un proceso hijo puntual con su jobId
   └─ devuelve el jobId inmediatamente

Proceso hijo
   ├─ ejecuta exactamente ese job
   ├─ registra progreso y heartbeat
   └─ termina al completar, fallar o cancelarse
```

El proceso recibirá directamente el identificador:

```text
bun apps/worker/src/sync-all.ts --job-id <id>
```

El lanzamiento se hará mediante argumentos, sin construir una cadena de shell:

```ts
Bun.spawn([
  process.execPath,
  "apps/worker/src/sync-all.ts",
  "--job-id",
  jobId,
]);
```

### 8.2. Inicio desde la CLI

Por defecto:

```text
series sync-all
```

La propia CLI:

1. Crea el job.
2. Ejecuta `syncAllWorks` en el mismo proceso.
3. Muestra progreso.
4. Actualiza SQLite.
5. Termina con un código de salida apropiado.

La CLI no tendrá modo separado. Para una ejecución desacoplada se utilizará la aplicación web, cuyo proceso servidor permanece vivo mientras el worker puntual completa el job.

### 8.3. Exclusión mutua

SQLite será responsable de garantizar que solo haya un `sync_all` activo:

```sql
CREATE UNIQUE INDEX only_one_active_sync_all
ON jobs(type)
WHERE type = 'sync_all'
  AND status IN ('pending', 'running');
```

No se usará un patrón vulnerable de consultar primero e insertar después. Web, CLI y agentes intentarán crear el job; si el índice rechaza el INSERT, mostrarán el job que ya está activo.

Esto protege frente a:

- Doble clic.
- Dos pestañas.
- Dos comandos CLI.
- Web y CLI simultáneas.
- Varios agentes.

### 8.4. Progreso en la web

La web consultará:

```text
GET /api/jobs/active?type=sync_all
GET /api/jobs/:jobId
```

La página preguntará periódicamente mientras exista un job activo. Al recargar, volverá a consultar el job activo en SQLite; no dependerá de memoria del navegador ni del servidor.

### 8.5. Heartbeat y recuperación

- El proceso actualizará `heartbeat_at` después de cada Obra.
- Si una consulta externa tarda, un temporizador mantendrá el heartbeat actualizado.
- Antes de crear un nuevo sync se revisará cualquier job activo existente.
- Si el heartbeat está vigente, se rechazará el nuevo job.
- Si está caducado y el proceso ya no existe, el job anterior se marcará `interrupted`.
- Después se podrá crear un job nuevo.
- No habrá un proceso periódico dedicado a esta limpieza.
- La comprobación se ejecutará bajo una transacción que evite carreras.

Un job interrumpido no se reanudará automáticamente. Se iniciará otro desde cero, aprovechando que la sincronización es idempotente.

### 8.6. Cancelación

La cancelación será cooperativa:

1. Web o CLI establece `cancellation_requested_at`.
2. El worker lo comprueba entre Obras.
3. Finaliza la Obra que estuviera aplicando.
4. Marca el job como `cancelled`.
5. Termina limpiamente.

No se matará el proceso mientras tenga una escritura en curso.

### 8.7. Fallo al lanzar el proceso

Si se crea el job pero `Bun.spawn` falla:

- La web marcará inmediatamente el job como `failed`.
- Guardará el error de lanzamiento.
- Devolverá un error accionable.
- El índice único dejará de bloquear futuros intentos porque el job ya no estará activo.

## 9. CLI

Nombre provisional: `series`.

```text
series search "Severance"
series add --tmdb tv:95396
series add --tmdb movie:157336
series sync --work tv:95396
series sync-all
series next --entry <id>
series transition --entry <id> --to watched
series abandon --entry <id> --reason "..."
series discard --work <id> --reason "..."
series jobs active
series jobs show <id>
series jobs cancel <id>
series validate
```

Requisitos:

- Operaciones relevantes con `--json`.
- `add` será un upsert.
- Errores con códigos estables para agentes.
- Operaciones forzadas pedirán confirmación salvo opción explícita.
- `sync-all` limitará concurrencia y respetará `Retry-After`.
- La salida resumirá cambios y errores por Obra.

## 10. Aplicación web

### 10.1. Dashboard

- Viendo ahora.
- Próximas: seleccionadas y listas para ver.
- Obras empezadas.
- Obras no planificadas.
- Estado de sincronización global.

### 10.2. Lecturas

No se realizará una petición SQLite por tarjeta.

Las consultas obtendrán conjuntamente Obras y Entregas, y construirán modelos de lectura específicos para cada pantalla. No se añadirá caché inicialmente.

### 10.3. Búsqueda y alta

- Búsqueda conjunta de películas y series en TMDB.
- Resultado con nombre, año, tipo y carátula.
- Alta/upsert desde el resultado.
- Prevención de duplicados mediante constraints SQLite.

### 10.4. Detalle de Obra

- Metadatos y carátula.
- Estado y progreso.
- Entregas ordenadas.
- Acción contextual `Siguiente paso`.
- Abandono y descarte con motivo.
- Sincronización individual.
- Descarga de carátula.

### 10.5. Sincronización global

- Inicio de proceso puntual.
- Recuperación de job activo al cargar o recargar.
- Polling de progreso.
- Resultado por Obra.
- Cancelación cooperativa.
- Distinción entre sin cambios, actualizado y error.

### 10.6. Administración mínima

- Historial reciente de jobs.
- Problemas de validación.
- Errores de sincronización.

## 11. Configuración

Variables locales previstas:

```text
DATABASE_PATH=.data/series-raqui.sqlite
TMDB_ACCESS_TOKEN=
```

Reglas:

- `.env` y `.data/` no se guardarán en Git.
- Se proporcionará `.env.example`.
- Los secretos solo se utilizarán en servidor, CLI o worker.
- TanStack Start usará server functions/server-only para toda operación sensible.

## 12. Railway futuro

No se implementará hasta tener la versión local funcional.

Diseño previsto:

- Un servicio persistente para la aplicación TanStack Start.
- Un volumen montado, por ejemplo, en `/app/data`.
- `DATABASE_PATH=/app/data/series-raqui.sqlite`.
- El proceso hijo de sync se ejecutará dentro del mismo contenedor y accederá al mismo volumen.
- Una única réplica de aplicación mientras se use SQLite sobre volumen.
- Backups del volumen habilitados.
- Autenticación obligatoria antes de exponer la aplicación.

No se diseñará inicialmente para varias réplicas concurrentes. Si esa necesidad aparece, se reevaluará la persistencia y la ejecución de jobs.

## 13. Pruebas

### Unitarias

- Todas las transiciones válidas e inválidas.
- Cálculo de Estados de Obra.
- Precedencia de estados.
- Entrega actual.
- Exclusión de especiales.
- Reglas de descarte y abandono.

### Integración SQLite

- Constraints y claves foráneas.
- Alta idempotente.
- Transacciones de progreso.
- Aparición de nuevas Entregas.
- Índice de exclusión de `sync_all`.
- Carrera simultánea al crear jobs.
- Heartbeat caducado y recuperación.
- Cancelación.
- Acceso simultáneo desde varios procesos en WAL.

### Integración TMDB

- Búsqueda localizada.
- Fallbacks de idioma e imagen.
- Sincronización que conserva progreso.
- Construcción de URLs de carátula.
- Reintentos y errores.

### Extremo a extremo

- Buscar, añadir y seleccionar desde la web.
- Recorrer una Entrega hasta Vista.
- Descubrir una nueva temporada estrenada.
- Iniciar sync desde web y observar progreso.
- Recargar la página durante el sync.
- Iniciar sync desde CLI y observarlo desde web.
- Rechazar un segundo sync simultáneo.
- Ejecutar comandos con salida JSON.

## 14. Fases

### Fase 1 — Fundaciones

- Inicializar Git, Bun y monorepo.
- Configurar TypeScript, linting, tests y variables de entorno.
- Crear conexión SQLite y migraciones.
- Implementar tablas, constraints e índices.

### Fase 2 — Dominio

- Entidades, tipos y errores.
- Transiciones y cálculos.
- Validaciones.
- Pruebas unitarias.

### Fase 3 — Repositorios y TMDB

- Repositorios SQLite.
- Cliente TMDB.
- Mapeadores.
- Transacciones y sincronización individual.
- Pruebas de integración.

### Fase 4 — Jobs y CLI

- Tablas y repositorio de jobs.
- Exclusión mutua.
- Heartbeat, recuperación y cancelación.
- Worker puntual de `sync-all`.
- CLI completa con salida humana y JSON.

### Fase 5 — Web

- Aplicación TanStack Start.
- Dashboard agregado.
- Búsqueda y alta.
- Detalle y progreso.
- Jobs, polling y cancelación.
- Descarga de carátulas.
- Créditos de TMDB.

### Fase 6 — Validación local

- Pruebas extremo a extremo.
- Cargar una biblioteca representativa.
- Validar rendimiento y experiencia.
- Documentar instalación y uso por agentes.

### Fase 7 — Despliegue futuro

- Railway y volumen persistente.
- Backups.
- Autenticación.
- Logs y health checks.
- Prueba completa del worker puntual en contenedor.

## 15. Criterios de aceptación de la primera versión

1. Buscar películas y series en TMDB desde web y CLI.
2. Añadirlas sin duplicados.
3. Crear correctamente Entregas estrenadas.
4. Recorrer estados desde ambas interfaces.
5. Mantener Estado y Entrega actual consistentes transaccionalmente.
6. Sincronizar sin pisar progreso.
7. Añadir una temporada cuando se estrene.
8. Ejecutar `sync-all` desde web o CLI.
9. Ver el progreso del job desde la web aunque lo iniciase la CLI.
10. Recuperar el progreso al recargar la página.
11. Rechazar dos sincronizaciones simultáneas sin carreras.
12. Detectar jobs interrumpidos mediante heartbeat.
13. Cancelar cooperativamente un job.
14. Mostrar y descargar carátulas desde TMDB.
15. Mantener secretos fuera del navegador y Git.
16. Cubrir reglas críticas mediante pruebas automatizadas.

## 16. Fuera de alcance inicial

- Episodios individuales.
- Notion.
- SQLite Cloud.
- Worker persistente o daemon de jobs.
- Polling interno de la tabla de jobs.
- Recomendador automático propio.
- Base de datos distinta de SQLite.
- Almacenamiento propio de imágenes.
- Aplicación móvil nativa.
- Multiusuario.
- Varias réplicas de aplicación.
- Relaciones entre películas, secuelas, precuelas, sagas, spin-offs o universos compartidos.
- Historial completo de transiciones.
- Despliegue antes de validar la versión local.

## 17. Orden exhaustivo de ejecución

Este será el orden de implementación. Cada bloque deberá quedar verificado antes de continuar con el siguiente.

### 17.1. Preparar el repositorio

1. Inicializar el repositorio Git.
2. Crear el `package.json` raíz para Bun workspaces.
3. Crear la estructura `apps/` y `packages/` definida en Arquitectura.
4. Configurar TypeScript compartido.
5. Configurar aliases internos de paquetes.
6. Configurar scripts raíz de desarrollo, build, tests y migraciones.
7. Crear `.gitignore` con `.env`, `.data/`, artefactos de build y dependencias.
8. Crear `.env.example` con `DATABASE_PATH` y `TMDB_ACCESS_TOKEN`.
9. Crear un README inicial con requisitos y comandos básicos.
10. Ejecutar una comprobación mínima de tipos y tests vacíos.

### 17.2. Crear la capa SQLite

11. Crear el paquete `packages/database`.
12. Implementar la apertura de SQLite mediante `bun:sqlite`.
13. Aplicar `foreign_keys`, WAL y `busy_timeout` al abrir conexiones.
14. Crear el sistema versionado de migraciones.
15. Crear la tabla `schema_migrations`.
16. Crear la migración inicial de `works`.
17. Crear la migración inicial de `entries`.
18. Crear las claves foráneas y constraints de unicidad.
19. Crear índices para Estado, Obra, orden, TMDB ID y fechas.
20. Crear la migración de `jobs`.
21. Crear la migración de `job_items`.
22. Crear el índice único parcial para un solo `sync_all` activo.
23. Añadir scripts `db:migrate`, `db:status` y `db:reset` solo para desarrollo.
24. Probar migración desde una base vacía.
25. Probar que ejecutar las migraciones dos veces es seguro.
26. Probar foreign keys, constraints e índice de exclusión.

### 17.3. Implementar el dominio

27. Crear los tipos `Work`, `Entry`, `WorkStatus` y `EntryStatus`.
28. Crear tipos para disponibilidad, lugar, plataforma y referencias TMDB.
29. Implementar errores de dominio estables.
30. Implementar la máquina de estados de Entregas.
31. Implementar la restricción de una sola Entrega `Viendo`.
32. Implementar la transición a Vista y su fecha manual o predeterminada.
33. Implementar abandono con motivo obligatorio.
34. Implementar descarte de Obras no empezadas.
35. Implementar el cálculo del Estado de una Obra.
36. Implementar la selección de Entrega actual.
37. Implementar exclusión de especiales del progreso.
38. Implementar `next`.
39. Implementar validación completa de un agregado Obra + Entregas.
40. Cubrir todas las reglas con tests unitarios.

### 17.4. Implementar repositorios

41. Definir los puertos `WorkRepository`, `EntryRepository` y `JobRepository` en Application.
42. Implementar el mapeo de filas SQLite a entidades de dominio.
43. Implementar altas y actualizaciones de Obras.
44. Implementar altas y actualizaciones de Entregas.
45. Implementar carga transaccional de una Obra con todas sus Entregas.
46. Implementar consultas para dashboard y detalle.
47. Implementar persistencia atómica de transición + Estado + Entrega actual.
48. Implementar repositorio de jobs y resultados por Obra.
49. Añadir tests de integración con una base temporal real.

### 17.5. Implementar TMDB

50. Crear el cliente HTTP autenticado de TMDB.
51. Implementar búsqueda multi de películas y series.
52. Implementar detalle de serie.
53. Implementar detalle de temporadas.
54. Implementar detalle de película.
55. Excluir colecciones y sagas del mapeo de dominio.
56. Implementar localización `es-ES` y fallback al idioma original.
57. Implementar selección de carátula y fallback de idioma.
58. Implementar construcción de URLs `w500` y `original`.
59. Implementar tratamiento de rate limits, timeouts y reintentos.
60. Implementar mapeadores de TMDB a candidatos de Obra y Entrega.
61. Filtrar Entregas futuras mediante su fecha de estreno.
62. Permitir temporadas desde la emisión del primer episodio.
63. Añadir tests con respuestas TMDB grabadas o fixtures representativos.

### 17.6. Implementar casos de uso principales

64. Implementar `searchCatalog`.
65. Implementar `addWork` como upsert idempotente.
66. Implementar alta de una película como Obra independiente con una Entrega.
67. Implementar alta de una serie con sus temporadas estrenadas.
68. Implementar `syncWork`.
69. Garantizar que un sync conserva todos los datos de usuario.
70. Implementar creación de nuevas temporadas estrenadas.
71. Implementar `transitionEntry`.
72. Implementar `advanceEntry`.
73. Implementar `abandonEntry`.
74. Implementar `discardWork`.
75. Implementar `getDashboard`.
76. Implementar `getWorkDetails`.
77. Implementar `validateLibrary`.
78. Añadir tests de integración de cada caso de uso.

### 17.7. Implementar jobs y sincronización global

79. Implementar la creación atómica de un job `sync_all`.
80. Traducir la violación del índice único a `SYNC_ALREADY_RUNNING`.
81. Implementar la consulta del job activo.
82. Implementar detalle e historial reciente de jobs.
83. Implementar reclamación directa de un job por su ID, sin escanear pendientes.
84. Implementar heartbeat periódico.
85. Implementar detección de heartbeat caducado al intentar iniciar otro sync.
86. Comprobar el PID local cuando sea aplicable.
87. Implementar transición de job obsoleto a `interrupted`.
88. Implementar solicitud y comprobación cooperativa de cancelación.
89. Implementar resultados `unchanged`, `changed` y `failed` por Obra.
90. Implementar contadores y resultado global.
91. Implementar `syncAllWorks` con concurrencia limitada.
92. Garantizar que cada Obra se aplica en una transacción independiente.
93. Implementar el entrypoint puntual `apps/worker/src/sync-all.ts`.
94. Implementar el launcher con `Bun.spawn` y argumentos seguros.
95. Marcar el job como fallido si el proceso no puede lanzarse.
96. Verificar que el proceso termina después de su único job.
97. Probar doble inicio simultáneo desde procesos distintos.
98. Probar interrupción, heartbeat obsoleto, recuperación y cancelación.

### 17.8. Implementar la CLI

99. Crear el ejecutable `series`.
100. Implementar configuración y comprobación de entorno.
101. Implementar salida humana compartida.
102. Implementar salida JSON estable.
103. Implementar `search`.
104. Implementar `add` para `tv` y `movie`.
105. Implementar `sync`.
106. Implementar `sync-all` en primer plano.
107. Implementar `next` y `transition`.
108. Implementar `abandon` y `discard`.
109. Implementar `jobs active`, `jobs show` y `jobs cancel`.
110. Implementar `validate`.
111. Añadir códigos de salida y códigos de error estables.
112. Documentar ejemplos destinados a Codex/ChatGPT.
113. Ejecutar un flujo completo únicamente mediante CLI.

### 17.9. Implementar la web

115. Inicializar TanStack Start con Bun.
116. Configurar límites server-only para SQLite y TMDB.
117. Crear layout, navegación y manejo global de errores.
118. Crear el dashboard con consultas agregadas.
119. Crear tarjetas de Obras sin patrón N+1.
120. Crear búsqueda TMDB.
121. Crear flujo de alta/upsert.
122. Crear detalle de Obra y listado de Entregas.
123. Crear acciones contextuales de progreso.
124. Crear formularios de abandono y descarte.
125. Crear sincronización individual.
126. Crear endpoint/server function para iniciar `sync_all`.
127. Crear consulta de job activo al cargar la aplicación.
128. Crear polling de progreso cada dos segundos.
129. Restaurar la vista del job después de recargar la página.
130. Mostrar jobs iniciados desde la CLI.
131. Crear cancelación cooperativa desde la UI.
132. Crear resumen final por Obra.
133. Crear descarga de carátulas en tamaños disponibles y original.
134. Añadir créditos y atribución de TMDB.
135. Verificar que ningún secreto llega al bundle del navegador.

### 17.10. Validación final local

136. Ejecutar formatter, lint, comprobación de tipos y tests.
137. Ejecutar todas las migraciones desde cero.
138. Probar una película independiente.
139. Probar una serie con varias temporadas.
140. Probar una temporada en emisión semanal y marcarla manualmente como Vista.
141. Probar una serie finalizada que recibe una temporada nueva ya estrenada.
142. Probar que una temporada futura no se crea.
143. Probar un sync sin cambios.
144. Probar un sync con cambios parciales y errores de TMDB.
145. Iniciar `sync-all` desde web y recargar la página.
146. Iniciar `sync-all` desde CLI y observarlo desde web.
147. Intentar iniciar dos syncs simultáneos.
148. Cancelar un sync.
149. Simular la muerte del proceso y recuperar el job interrumpido.
150. Validar la biblioteca completa.
151. Revisar rendimiento y ausencia de N+1.
152. Revisar accesibilidad y estados de carga/error.
153. Completar README de instalación, uso y resolución de problemas.
154. Crear una copia de seguridad de prueba del fichero SQLite y restaurarla.
155. Considerar finalizada la versión local solo si se cumplen todos los criterios de aceptación.

### 17.11. Despliegue futuro en Railway

156. Elegir el momento de despliegue después de validar local.
157. Crear el servicio persistente en Railway.
158. Añadir y montar el volumen en `/app/data`.
159. Configurar `DATABASE_PATH` y secretos.
160. Añadir autenticación antes de crear un dominio público.
161. Ejecutar migraciones con el volumen montado.
162. Mantener una única réplica de aplicación.
163. Configurar health checks, logs y backups.
164. Verificar que el proceso puntual accede al mismo fichero SQLite.
165. Repetir las pruebas críticas de jobs y sincronización.
166. Probar restauración de backup.
167. Publicar únicamente después de validar autenticación y persistencia.
