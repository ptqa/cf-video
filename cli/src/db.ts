/**
 * D1 REST API client for CLI.
 */

import { type Config } from './config';

interface D1Result {
  results: Record<string, unknown>[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1Response {
  result: D1Result[];
  success: boolean;
  errors: { code: number; message: string }[];
}

export class D1Client {
  private accountId: string;
  private databaseId: string;
  private apiToken: string;

  constructor(config: Config) {
    this.accountId = config.cloudflare.account_id;
    this.databaseId = config.d1.database_id;
    this.apiToken = config.cloudflare.api_token;
  }

  async execute(sql: string, params: unknown[] = []): Promise<D1Result> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`D1 API error (${response.status}): ${text}`);
    }

    const data = await response.json() as D1Response;
    if (!data.success) {
      throw new Error(`D1 query failed: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return data.result[0];
  }

  async batch(statements: { sql: string; params: unknown[] }[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const stmt of statements) {
      results.push(await this.execute(stmt.sql, stmt.params));
    }
    return results;
  }

  // ─── User operations ───────────────────────────────────────────────────────

  async createUser(id: string, username: string, password: string, isAdmin: boolean): Promise<void> {
    await this.execute(
      'INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)',
      [id, username, password, isAdmin ? 1 : 0]
    );
  }

  async getUsers(): Promise<{ id: string; username: string; is_admin: number }[]> {
    const result = await this.execute('SELECT id, username, is_admin FROM users ORDER BY username');
    return result.results as { id: string; username: string; is_admin: number }[];
  }

  // ─── Library operations ────────────────────────────────────────────────────

  async createLibrary(id: string, name: string, type: 'movies' | 'tvshows', pathPrefix: string): Promise<void> {
    await this.execute(
      'INSERT INTO libraries (id, name, type, path_prefix) VALUES (?, ?, ?, ?)',
      [id, name, type, pathPrefix]
    );
  }

  // ─── Movie operations ──────────────────────────────────────────────────────

  async upsertMovie(movie: {
    id: string;
    title: string;
    original_title?: string | null;
    year?: number | null;
    runtime?: number | null;
    plot?: string | null;
    tmdb_id?: string | null;
    imdb_id?: string | null;
    rating?: number | null;
    content_type?: string;
    container?: string;
    video_codec?: string | null;
    video_width?: number | null;
    video_height?: number | null;
    video_fps?: number | null;
    audio_codec?: string | null;
    audio_channels?: number | null;
    r2_key: string;
    poster_r2_key?: string | null;
    backdrop_r2_key?: string | null;
    file_size?: number | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO movies (
        id, title, original_title, year, runtime, plot, tmdb_id, imdb_id, rating,
        content_type, container, video_codec, video_width, video_height, video_fps,
        audio_codec, audio_channels, r2_key, poster_r2_key, backdrop_r2_key, file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        original_title = excluded.original_title,
        year = excluded.year,
        runtime = excluded.runtime,
        plot = excluded.plot,
        tmdb_id = excluded.tmdb_id,
        imdb_id = excluded.imdb_id,
        rating = excluded.rating,
        video_codec = excluded.video_codec,
        video_width = excluded.video_width,
        video_height = excluded.video_height,
        video_fps = excluded.video_fps,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        poster_r2_key = COALESCE(excluded.poster_r2_key, movies.poster_r2_key),
        backdrop_r2_key = COALESCE(excluded.backdrop_r2_key, movies.backdrop_r2_key),
        file_size = excluded.file_size,
        updated_at = datetime('now')`,
      [
        movie.id, movie.title, movie.original_title || null, movie.year || null,
        movie.runtime || null, movie.plot || null, movie.tmdb_id || null,
        movie.imdb_id || null, movie.rating || null, movie.content_type || 'video/mp4',
        movie.container || 'mp4', movie.video_codec || null, movie.video_width || null,
        movie.video_height || null, movie.video_fps || null, movie.audio_codec || null,
        movie.audio_channels || null, movie.r2_key, movie.poster_r2_key || null,
        movie.backdrop_r2_key || null, movie.file_size || null,
      ]
    );
  }

  // ─── TV Show operations ──────────────────────────────────────────────────

  async upsertTVShow(show: {
    id: string;
    title: string;
    original_title?: string | null;
    year?: number | null;
    plot?: string | null;
    tmdb_id?: string | null;
    imdb_id?: string | null;
    rating?: number | null;
    poster_r2_key?: string | null;
    backdrop_r2_key?: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO tv_shows (id, title, original_title, year, plot, tmdb_id, imdb_id, rating, poster_r2_key, backdrop_r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         original_title = excluded.original_title,
         year = excluded.year,
         plot = excluded.plot,
         tmdb_id = excluded.tmdb_id,
         imdb_id = excluded.imdb_id,
         rating = excluded.rating,
         poster_r2_key = COALESCE(excluded.poster_r2_key, tv_shows.poster_r2_key),
         backdrop_r2_key = COALESCE(excluded.backdrop_r2_key, tv_shows.backdrop_r2_key)`,
      [show.id, show.title, show.original_title || null, show.year || null, show.plot || null,
       show.tmdb_id || null, show.imdb_id || null, show.rating || null,
       show.poster_r2_key || null, show.backdrop_r2_key || null]
    );
  }

  async upsertSeason(season: {
    id: string;
    show_id: string;
    season_number: number;
    title?: string | null;
    plot?: string | null;
    year?: number | null;
    poster_r2_key?: string | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO seasons (id, show_id, season_number, title, plot, year, poster_r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         plot = excluded.plot,
         year = excluded.year,
         poster_r2_key = COALESCE(excluded.poster_r2_key, seasons.poster_r2_key)`,
      [season.id, season.show_id, season.season_number, season.title || null,
       season.plot || null, season.year || null, season.poster_r2_key || null]
    );
  }

  async upsertEpisode(episode: {
    id: string;
    show_id: string;
    season_id: string;
    episode_number: number;
    title: string;
    plot?: string | null;
    runtime?: number | null;
    tmdb_id?: string | null;
    content_type?: string;
    container?: string;
    video_codec?: string | null;
    video_width?: number | null;
    video_height?: number | null;
    video_fps?: number | null;
    audio_codec?: string | null;
    audio_channels?: number | null;
    r2_key: string;
    poster_r2_key?: string | null;
    file_size?: number | null;
  }): Promise<void> {
    await this.execute(
      `INSERT INTO episodes (
        id, show_id, season_id, episode_number, title, plot, runtime, tmdb_id,
        content_type, container, video_codec, video_width, video_height, video_fps,
        audio_codec, audio_channels, r2_key, poster_r2_key, file_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        plot = excluded.plot,
        runtime = excluded.runtime,
        tmdb_id = excluded.tmdb_id,
        video_codec = excluded.video_codec,
        video_width = excluded.video_width,
        video_height = excluded.video_height,
        video_fps = excluded.video_fps,
        audio_codec = excluded.audio_codec,
        audio_channels = excluded.audio_channels,
        poster_r2_key = COALESCE(excluded.poster_r2_key, episodes.poster_r2_key),
        file_size = excluded.file_size`,
      [
        episode.id, episode.show_id, episode.season_id, episode.episode_number,
        episode.title, episode.plot || null, episode.runtime || null, episode.tmdb_id || null,
        episode.content_type || 'video/mp4', episode.container || 'mp4', episode.video_codec || null,
        episode.video_width || null, episode.video_height || null, episode.video_fps || null,
        episode.audio_codec || null, episode.audio_channels || null, episode.r2_key,
        episode.poster_r2_key || null, episode.file_size || null,
      ]
    );
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  async getStats(): Promise<{
    movies: number;
    tvShows: number;
    seasons: number;
    episodes: number;
    users: number;
  }> {
    const [movies, tvShows, seasons, episodes, users] = await Promise.all([
      this.execute('SELECT COUNT(*) as count FROM movies'),
      this.execute('SELECT COUNT(*) as count FROM tv_shows'),
      this.execute('SELECT COUNT(*) as count FROM seasons'),
      this.execute('SELECT COUNT(*) as count FROM episodes'),
      this.execute('SELECT COUNT(*) as count FROM users'),
    ]);

    return {
      movies: (movies.results[0]?.count as number) || 0,
      tvShows: (tvShows.results[0]?.count as number) || 0,
      seasons: (seasons.results[0]?.count as number) || 0,
      episodes: (episodes.results[0]?.count as number) || 0,
      users: (users.results[0]?.count as number) || 0,
    };
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  async nukeAll(): Promise<void> {
    const tables = [
      'user_data',
      'episodes',
      'seasons',
      'tv_shows',
      'movies',
      'libraries',
      'users',
    ];
    for (const table of tables) {
      await this.execute(`DELETE FROM ${table}`);
    }
  }
}