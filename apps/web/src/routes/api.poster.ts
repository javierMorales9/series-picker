import { createFileRoute } from "@tanstack/react-router";

const sizes = new Set(["w185", "w342", "w500", "w780", "original"]);

export const Route = createFileRoute("/api/poster")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const path = url.searchParams.get("path");
        const size = url.searchParams.get("size") || "original";
        const name = (url.searchParams.get("name") || "caratula").replace(
          /[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ_-]+/g,
          "-",
        );
        if (!path?.startsWith("/") || path.includes("..") || !sizes.has(size))
          return new Response("Parámetros inválidos", { status: 400 });
        const response = await fetch(
          `https://image.tmdb.org/t/p/${size}${path}`,
        );
        if (!response.ok || !response.body)
          return new Response("No se pudo descargar la carátula", {
            status: 502,
          });
        const extension = path.split(".").at(-1) || "jpg";
        return new Response(response.body, {
          headers: {
            "content-type":
              response.headers.get("content-type") || "image/jpeg",
            "content-disposition": `attachment; filename="${name}.${extension}"`,
            "cache-control": "public, max-age=86400",
          },
        });
      },
    },
  },
});
