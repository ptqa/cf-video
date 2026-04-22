import { type Movie, type TVShow, type Season, type Episode, type User, type Library, type UserData } from '../types';

// ─── Users ─────────────────────────────────────────────────────────────────

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
}

export async function getUserByUsername(db: D1Database, username: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<User>();
}

export async function getAllUsers(db: D1Database): Promise<User[]> {
  const { results } = await db.prepare('SELECT * FROM users ORDER BY username').all<User>();
  return results;
}

export async function getPublicUsers(db: D1Database): Promise<User[]> {
  // Return non-hidden, non-disabled users
  const { results } = await db.prepare(
    'SELECT * FROM users WHERE is_admin = 0 ORDER BY username'
  ).all<User>();
  return results;
}

export async function createUser(
  db: D1Database,
  id: string,
  username: string,
  passwordHash: string,
  isAdmin: boolean
): Promise<void> {
  await db.prepare(
    'INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)'
  ).bind(id, username, passwordHash, isAdmin ? 1 : 0).run();
}

// ─── Libraries ────────────────────────────────────────────────────────────

export async function getLibraries(db: D1Database): Promise<Library[]> {
  const { results } = await db.prepare('SELECT * FROM libraries ORDER BY name').all<Library>();
  return results;
}

export async function getLibrary(db: D1Database, id: string): Promise<Library | null> {
  return db.prepare('SELECT * FROM libraries WHERE id = ?').bind(id).first<Library>();
}

// ─── Movies ─────────────────────────────────────────────────────────────────

export async function getMovies(db: D1Database, limit: number = 100, offset: number = 0): Promise<Movie[]> {
  const { results } = await db.prepare(
    'SELECT * FROM movies ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?'
  ).bind(limit, offset).all<Movie>();
  return results;
}

export async function getMovie(db: D1Database, id: string): Promise<Movie | null> {
  return db.prepare('SELECT * FROM movies WHERE id = ?').bind(id).first<Movie>();
}

export async function getMovieByTmdbId(db: D1Database, tmdbId: string): Promise<Movie | null> {
  return db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').bind(tmdbId).first<Movie>();
}

export async function searchMovies(db: D1Database, query: string, limit: number = 20): Promise<Movie[]> {
  const like = `%${query}%`;
  const { results } = await db.prepare(
    'SELECT * FROM movies WHERE title LIKE ? OR original_title LIKE ? ORDER BY title COLLATE NOCASE LIMIT ?'
  ).bind(like, like, limit).all<Movie>();
  return results;
}

// ─── TV Shows ───────────────────────────────────────────────────────────────

export async function getTVShows(db: D1Database, limit: number = 100, offset: number = 0): Promise<TVShow[]> {
  const { results } = await db.prepare(
    'SELECT * FROM tv_shows ORDER BY title COLLATE NOCASE LIMIT ? OFFSET ?'
  ).bind(limit, offset).all<TVShow>();
  return results;
}

export async function getTVShow(db: D1Database, id: string): Promise<TVShow | null> {
  return db.prepare('SELECT * FROM tv_shows WHERE id = ?').bind(id).first<TVShow>();
}

export async function getTVShowByTmdbId(db: D1Database, tmdbId: string): Promise<TVShow | null> {
  return db.prepare('SELECT * FROM tv_shows WHERE tmdb_id = ?').bind(tmdbId).first<TVShow>();
}

export async function searchTVShows(db: D1Database, query: string, limit: number = 20): Promise<TVShow[]> {
  const like = `%${query}%`;
  const { results } = await db.prepare(
    'SELECT * FROM tv_shows WHERE title LIKE ? OR original_title LIKE ? ORDER BY title COLLATE NOCASE LIMIT ?'
  ).bind(like, like, limit).all<TVShow>();
  return results;
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

export async function getSeasons(db: D1Database, showId: string): Promise<Season[]> {
  const { results } = await db.prepare(
    'SELECT * FROM seasons WHERE show_id = ? ORDER BY season_number'
  ).bind(showId).all<Season>();
  return results;
}

export async function getSeason(db: D1Database, id: string): Promise<Season | null> {
  return db.prepare('SELECT * FROM seasons WHERE id = ?').bind(id).first<Season>();
}

// ─── Episodes ────────────────────────────────────────────────────────────────

export async function getEpisodes(db: D1Database, seasonId: string): Promise<Episode[]> {
  const { results } = await db.prepare(
    'SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number'
  ).bind(seasonId).all<Episode>();
  return results;
}

export async function getEpisodesByShow(db: D1Database, showId: string): Promise<Episode[]> {
  const { results } = await db.prepare(
    'SELECT * FROM episodes WHERE show_id = ? ORDER BY episode_number'
  ).bind(showId).all<Episode>();
  return results;
}

export async function getEpisode(db: D1Database, id: string): Promise<Episode | null> {
  return db.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<Episode>();
}

// ─── User Data ───────────────────────────────────────────────────────────────

export async function getUserData(
  db: D1Database,
  userId: string,
  itemId: string,
  itemType: 'movie' | 'episode'
): Promise<UserData | null> {
  return db.prepare(
    'SELECT * FROM user_data WHERE user_id = ? AND item_id = ? AND item_type = ?'
  ).bind(userId, itemId, itemType).first<UserData>();
}

export async function setUserData(
  db: D1Database,
  userId: string,
  itemId: string,
  itemType: 'movie' | 'episode',
  data: Partial<Omit<UserData, 'user_id' | 'item_id' | 'item_type'>>
): Promise<void> {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.is_favorite !== undefined) {
    fields.push('is_favorite');
    values.push(data.is_favorite);
  }
  if (data.played !== undefined) {
    fields.push('played');
    values.push(data.played);
  }
  if (data.playback_position !== undefined) {
    fields.push('playback_position');
    values.push(data.playback_position);
  }
  if (data.last_played_at !== undefined) {
    fields.push('last_played_at');
    values.push(data.last_played_at);
  }

  if (fields.length === 0) return;

  const setClause = fields.map(f => `${f} = ?`).join(', ');
  await db.prepare(
    `INSERT INTO user_data (user_id, item_id, item_type, ${fields.join(', ')}) 
     VALUES (?, ?, ?, ${fields.map(() => '?').join(', ')})
     ON CONFLICT(user_id, item_id, item_type) DO UPDATE SET ${setClause}`
  ).bind(userId, itemId, itemType, ...values, ...values).run();
}

export async function getContinueWatching(
  db: D1Database,
  userId: string,
  limit: number = 10
): Promise<(UserData & { item: Movie | Episode })[]> {
  const { results } = await db.prepare(
    `SELECT ud.*, 
      CASE 
        WHEN ud.item_type = 'movie' THEN json_object('id', m.id, 'title', m.title, 'year', m.year, 'runtime', m.runtime, 'plot', m.plot, 'poster_r2_key', m.poster_r2_key)
        ELSE json_object('id', e.id, 'title', e.title, 'episode_number', e.episode_number, 'runtime', e.runtime, 'plot', e.plot, 'poster_r2_key', e.poster_r2_key)
      END as item
     FROM user_data ud
     LEFT JOIN movies m ON ud.item_id = m.id AND ud.item_type = 'movie'
     LEFT JOIN episodes e ON ud.item_id = e.id AND ud.item_type = 'episode'
     WHERE ud.user_id = ? AND ud.playback_position > 0 AND ud.played = 0
     ORDER BY ud.last_played_at DESC
     LIMIT ?`
  ).bind(userId, limit).all<UserData & { item: Movie | Episode }>();
  return results;
}

export async function getRecentlyAdded(
  db: D1Database,
  userId: string,
  limit: number = 10
): Promise<(Movie | Episode)[]> {
  const { results } = await db.prepare(
    `SELECT * FROM (
      SELECT id, title, year, plot, poster_r2_key, created_at, 'movie' as type, runtime, null as episode_number
      FROM movies
      UNION ALL
      SELECT id, title, null as year, plot, poster_r2_key, created_at, 'episode' as type, runtime, episode_number
      FROM episodes
    ) ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all<Movie | Episode>();
  return results;
}