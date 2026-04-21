-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Libraries (Movies, TV Shows)
CREATE TABLE IF NOT EXISTS libraries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('movies', 'tvshows')),
  path_prefix TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Movies
CREATE TABLE IF NOT EXISTS movies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  runtime INTEGER,
  plot TEXT,
  tmdb_id TEXT,
  imdb_id TEXT,
  rating REAL,
  content_type TEXT DEFAULT 'video/mp4',
  container TEXT DEFAULT 'mp4',
  video_codec TEXT,
  video_width INTEGER,
  video_height INTEGER,
  video_fps REAL,
  audio_codec TEXT,
  audio_channels INTEGER,
  r2_key TEXT NOT NULL,
  poster_r2_key TEXT,
  backdrop_r2_key TEXT,
  file_size INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- TV Shows
CREATE TABLE IF NOT EXISTS tv_shows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  plot TEXT,
  tmdb_id TEXT,
  imdb_id TEXT,
  rating REAL,
  poster_r2_key TEXT,
  backdrop_r2_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seasons
CREATE TABLE IF NOT EXISTS seasons (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES tv_shows(id),
  season_number INTEGER NOT NULL,
  title TEXT,
  plot TEXT,
  year INTEGER,
  poster_r2_key TEXT,
  episode_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Episodes
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  show_id TEXT NOT NULL REFERENCES tv_shows(id),
  season_id TEXT NOT NULL REFERENCES seasons(id),
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  plot TEXT,
  runtime INTEGER,
  tmdb_id TEXT,
  content_type TEXT DEFAULT 'video/mp4',
  container TEXT DEFAULT 'mp4',
  video_codec TEXT,
  video_width INTEGER,
  video_height INTEGER,
  video_fps REAL,
  audio_codec TEXT,
  audio_channels INTEGER,
  r2_key TEXT NOT NULL,
  poster_r2_key TEXT,
  file_size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- User playback state (resume position, watched)
CREATE TABLE IF NOT EXISTS user_data (
  user_id TEXT NOT NULL REFERENCES users(id),
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('movie', 'episode')),
  is_favorite INTEGER DEFAULT 0,
  played INTEGER DEFAULT 0,
  playback_position INTEGER DEFAULT 0,
  last_played_at TEXT,
  PRIMARY KEY (user_id, item_id, item_type)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_movies_year ON movies(year);
CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
CREATE INDEX IF NOT EXISTS idx_tv_shows_tmdb ON tv_shows(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_seasons_show ON seasons(show_id);
CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id);
CREATE INDEX IF NOT EXISTS idx_user_data_user ON user_data(user_id);
