import { describe, expect, test } from "bun:test";
import { TmdbClient } from "./index.ts";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TMDB", () => {
  test("busca solo series y películas", async () => {
    const client = new TmdbClient(
      "token",
      async () =>
        response({
          results: [
            {
              media_type: "tv",
              id: 1,
              name: "Serie",
              original_name: "Show",
              first_air_date: "2020-01-01",
              poster_path: "/a.jpg",
              overview: "",
            },
            { media_type: "person", id: 2, name: "Persona" },
          ],
        }) as any,
    );
    const results = await client.search("serie");
    expect(results).toHaveLength(1);
    expect(results[0]?.tmdbType).toBe("tv");
  });
  test("excluye temporadas futuras y deja los especiales al final", async () => {
    const client = new TmdbClient(
      "token",
      async () =>
        response({
          id: 1,
          name: "Serie",
          original_name: "Show",
          first_air_date: "2020-01-01",
          poster_path: null,
          seasons: [
            {
              id: 10,
              season_number: 0,
              name: "Especiales",
              air_date: "2020-01-01",
              poster_path: null,
            },
            {
              id: 11,
              season_number: 1,
              name: "T1",
              air_date: "2020-01-01",
              poster_path: null,
            },
            {
              id: 12,
              season_number: 2,
              name: "T2",
              air_date: "2021-01-01",
              poster_path: null,
            },
            {
              id: 13,
              season_number: 3,
              name: "T3",
              air_date: "2999-01-01",
              poster_path: null,
            },
          ],
        }) as any,
    );
    const work = await client.getWork("tv", 1);
    expect(work.entries.map((entry) => entry.name)).toEqual([
      "T1",
      "T2",
      "Especiales",
    ]);
    expect(work.entries.map((entry) => entry.position)).toEqual([1, 2, 3]);
    const especiales = work.entries.at(-1);
    expect(especiales?.seasonNumber).toBe(0);
    expect(especiales?.countsTowardsProgress).toBe(false);
  });
  test("no añade películas futuras", async () => {
    const client = new TmdbClient(
      "token",
      async () =>
        response({
          id: 1,
          title: "Futura",
          original_title: "Future",
          release_date: "2999-01-01",
          poster_path: null,
        }) as any,
    );
    expect(client.getWork("movie", 1)).rejects.toThrow();
  });
  test("construye URLs de carátula", () => {
    expect(new TmdbClient("token").posterUrl("/x.jpg", "original")).toBe(
      "https://image.tmdb.org/t/p/original/x.jpg",
    );
  });
});
