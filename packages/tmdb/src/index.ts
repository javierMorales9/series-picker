import type {
  CatalogResult,
  ExternalEntry,
  ExternalWork,
  MetadataProvider,
} from "@series-raqui/application";
import type { TmdbType } from "@series-raqui/domain";

const API = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";
type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class TmdbError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export class TmdbClient implements MetadataProvider {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetcher = fetch,
  ) { }

  async search(query: string): Promise<CatalogResult[]> {
    const data = await this.request<any>(
      `/search/multi?query=${encodeURIComponent(query)}&language=es-ES&include_adult=false`,
    );
    return (data.results as any[])
      .filter((item) => item.media_type === "tv" || item.media_type === "movie")
      .map((item) => ({
        tmdbType: item.media_type,
        tmdbId: item.id,
        name: item.title ?? item.name,
        originalName: item.original_title ?? item.original_name ?? null,
        year: this.year(item.release_date ?? item.first_air_date),
        posterPath: item.poster_path ?? null,
        overview: item.overview || null,
      }));
  }

  async getWork(tmdbType: TmdbType, tmdbId: number): Promise<ExternalWork> {
    return tmdbType === "movie"
      ? this.getMovie(tmdbId)
      : this.getSeries(tmdbId);
  }

  posterUrl(path: string | null, size = "w500"): string | null {
    return path ? `${IMAGE}/${size}${path}` : null;
  }

  private async getMovie(id: number): Promise<ExternalWork> {
    const item = await this.request<any>(`/movie/${id}?language=es-ES`);
    const releaseDate = item.release_date || null;
    if (!this.released(releaseDate))
      throw Object.assign(
        new Error("La película todavía no se ha estrenado."),
        { code: "NOT_RELEASED" },
      );
    const entry: ExternalEntry = {
      tmdbId: item.id,
      type: "movie",
      name: item.title,
      originalName: item.original_title ?? null,
      position: 1,
      seasonNumber: null,
      releaseDate,
      posterPath: item.poster_path ?? null,
      countsTowardsProgress: true,
    };
    return {
      tmdbType: "movie",
      tmdbId: item.id,
      type: "movie",
      name: item.title,
      originalName: item.original_title ?? null,
      startYear: this.year(releaseDate),
      posterPath: item.poster_path ?? null,
      entries: [entry],
    };
  }

  private async getSeries(id: number): Promise<ExternalWork> {
    const item = await this.request<any>(`/tv/${id}?language=es-ES`);
    const entries: ExternalEntry[] = (item.seasons as any[])
      .filter((season) => this.released(season.air_date))
      .map((season) => ({
        tmdbId: season.id,
        type: "season" as const,
        name: season.name || `T${season.season_number}`,
        originalName: null,
        position: season.season_number,
        seasonNumber: season.season_number,
        releaseDate: season.air_date || null,
        posterPath: season.poster_path ?? null,
        countsTowardsProgress: season.season_number !== 0,
      }));
    return {
      tmdbType: "tv",
      tmdbId: item.id,
      type: "series",
      name: item.name,
      originalName: item.original_name ?? null,
      startYear: this.year(item.first_air_date),
      posterPath: item.poster_path ?? null,
      entries,
    };
  }

  private released(date: string | null | undefined): boolean {
    return Boolean(date && date <= new Date().toISOString().slice(0, 10));
  }
  private year(date: string | null | undefined): number | null {
    return date ? Number(date.slice(0, 4)) || null : null;
  }
  private async request<T>(path: string, attempt = 0): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const wait =
        Number(response.headers.get("retry-after") || 2 ** attempt) * 1000;
      await Bun.sleep(wait);
      return this.request<T>(path, attempt + 1);
    }
    if (!response.ok)
      throw new TmdbError(
        response.status,
        `TMDB respondió ${response.status}: ${await response.text()}`,
      );
    return response.json() as Promise<T>;
  }
}
