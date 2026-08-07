# El build necesita las devDependencies (vite, typescript); la imagen final no.
FROM oven/bun:1.3.10-alpine AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun --filter @series-raqui/web build

FROM oven/bun:1.3.10-alpine
WORKDIR /app

# El código fuente se queda en la imagen: los jobs lanzan apps/worker con Bun,
# y los packages del workspace se resuelven por symlink a sus .ts.
COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile --production
COPY --from=build /app/apps/web/dist ./apps/web/dist

ENV NODE_ENV=production
# La base vive en el volumen de Railway, no en el sistema de ficheros del contenedor.
ENV DATABASE_PATH=/data/series-raqui.sqlite

EXPOSE 3000

# Las migraciones van antes de servir para fallar pronto si la base no está bien.
# Se llama a los scripts de apps/web en vez de a los del root, que pasan por
# dotenvx y aquí no hay ningún .env: las variables las inyecta Railway.
CMD ["sh", "-c", "bun apps/cli/src/db.ts migrate && bun --filter @series-raqui/web start"]
