/**
 * TMDB API client for fetching movie and TV show metadata.
 */

import { type Config } from './config';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export class TMDBClient {
  private apiKey: string;

  constructor(config: Config) {
    this.apiKey = config.tmdb.api_key;
  }

  private async fetch(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const queryParams = new URLSearchParams({ ...params, api_key: this.apiKey });
    const url = `${TMDB_BASE_URL}${path}?${queryParams}`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDB API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }

  // ─── Movies ───────────────────────────────────────────────────────────────

  async searchMovie(query: string, year?: number): Promise<{ results: Array<{ id: number; title: string; release_date: string; overview: string; poster_path: string | null; backdrop_path: string | null; vote_average: number }> }> {
    const params: Record<string, string> = { query };
    if (year) params.year = String(year);
    return this.fetch('/search/movie', params) as Promise<{ results: Array<{ id: number; title: string; release_date: string; overview: string; poster_path: string | null; backdrop_path: string | null; vote_average: number }> }>;
  }

  async getMovieDetails(tmdbId: number): Promise<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
    runtime: number;
    overview: string;
    imdb_id: string | null;
    vote_average: number;
    poster_path: string | null;
    backdrop_path: string | null;
  }> {
    return this.fetch(`/movie/${tmdbId}`, { append_to_response: 'external_ids' }) as Promise<{
      id: number;
      title: string;
      original_title: string;
      release_date: string;
      runtime: number;
      overview: string;
      imdb_id: string | null;
      vote_average: number;
      poster_path: string | null;
      backdrop_path: string | null;
    }>;
  }

  // ─── TV Shows ──────────────────────────────────────────────────────────────

  async searchTVShow(query: string): Promise<{ results: Array<{ id: number; name: string; first_air_date: string; overview: string; poster_path: string | null; backdrop_path: string | null; vote_average: number }> }> {
    return this.fetch('/search/tv', { query }) as Promise<{ results: Array<{ id: number; name: string; first_air_date: string; overview: string; poster_path: string | null; backdrop_path: string | null; vote_average: number }> }>;
  }

  async getTVShowDetails(tmdbId: number): Promise<{
    id: number;
    name: string;
    original_name: string;
    first_air_date: string;
    overview: string;
    vote_average: number;
    poster_path: string | null;
    backdrop_path: string | null;
    external_ids: { imdb_id: string | null };
  }> {
    return this.fetch(`/tv/${tmdbId}`, { append_to_response: 'external_ids' }) as Promise<{
      id: number;
      name: string;
      original_name: string;
      first_air_date: string;
      overview: string;
      vote_average: number;
      poster_path: string | null;
      backdrop_path: string | null;
      external_ids: { imdb_id: string | null };
    }>;
  }

  async getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<{
    id: number;
    episodes: Array<{
      id: number;
      episode_number: number;
      name: string;
      overview: string | null;
      air_date: string | null;
      runtime: number | null;
      still_path: string | null;
    }>;
  }> {
    return this.fetch(`/tv/${tmdbId}/season/${seasonNumber}`) as Promise<{
      id: number;
      episodes: Array<{
        id: number;
        episode_number: number;
        name: string;
        overview: string | null;
        air_date: string | null;
        runtime: number | null;
        still_path: string | null;
      }>;
    }>;
  }

  // ─── Image helpers ─────────────────────────────────────────────────────────

  getPosterUrl(path: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w342'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
  }

  getBackdropUrl(path: string | null, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
    if (!path) return null;
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
  }

  async downloadImage(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}