# CF-Video Implementation Plan

A serverless Jellyfin-compatible video streaming server on Cloudflare Workers + R2 + D1.

## Project Overview

**Goal**: Build a video streaming server that:
- Runs entirely on Cloudflare's edge infrastructure (zero server management)
- Implements the Jellyfin API for compatibility with existing clients
- Stores videos on R2 (zero egress fees)
- Uses D1 for metadata (SQLite at the edge)
- Requires no transcoding (direct stream only)

**Name**: `cf-video` (working title)

---

## Phase 1: Infrastructure & Database (Week 1)

### 1.1 Project Setup

```bash
# Create project structure
cf-video/
├── worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── types.ts
│   │   ├── handlers/
│   │   └── db/
│   ├── wrangler.toml
│   └── package.json
├── cli/
│   ├── src/
│   └── package.json
└── README.md
```

### 1.2 D1 Database Schema

Create `worker/src/db/schema.sql`:

```sql
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
CREATE INDEX idx_movies_tmdb ON movies(tmdb_id);
CREATE INDEX idx_movies_year ON movies(year);
CREATE INDEX idx_movies_title ON movies(title);
CREATE INDEX idx_tv_shows_tmdb ON tv_shows(tmdb_id);
CREATE INDEX idx_seasons_show ON seasons(show_id);
CREATE INDEX idx_episodes_season ON episodes(season_id);
CREATE INDEX idx_episodes_show ON episodes(show_id);
CREATE INDEX idx_user_data_user ON user_data(user_id);
```

### 1.3 Wrangler Configuration

Create `worker/wrangler.toml`:

```toml
name = "cf-video"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
SERVER_NAME = "CF-Video"
SERVER_VERSION = "0.1.0"
TMDB_API_BASE = "https://api.themoviedb.org/3"

[[d1_databases]]
binding = "DB"
database_name = "cf-video-metadata"
database_id = "YOUR_D1_DATABASE_ID"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "cf-video"
```

---

## Phase 2: Worker API Implementation (Week 2-3)

### 2.1 Core Types

Create `worker/src/types.ts`:

```typescript
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SERVER_NAME: string;
  SERVER_VERSION: string;
  TMDB_API_BASE: string;
  TMDB_API_KEY?: string;
  JWT_SECRET: string;
}

// User types
export interface User {
  id: string;
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: string;
}

// Movie types
export interface Movie {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  runtime: number | null;
  plot: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  rating: number | null;
  content_type: string;
  container: string;
  video_codec: string | null;
  video_width: number | null;
  video_height: number | null;
  video_fps: number | null;
  audio_codec: string | null;
  audio_channels: number | null;
  r2_key: string;
  poster_r2_key: string | null;
  backdrop_r2_key: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
}

// TV Show types
export interface TVShow {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  plot: string | null;
  tmdb_id: string | null;
  imdb_id: string | null;
  rating: number | null;
  poster_r2_key: string | null;
  backdrop_r2_key: string | null;
  created_at: string;
}

export interface Season {
  id: string;
  show_id: string;
  season_number: number;
  title: string | null;
  plot: string | null;
  year: number | null;
  poster_r2_key: string | null;
  episode_count: number;
  created_at: string;
}

export interface Episode {
  id: string;
  show_id: string;
  season_id: string;
  episode_number: number;
  title: string;
  plot: string | null;
  runtime: number | null;
  tmdb_id: string | null;
  content_type: string;
  container: string;
  video_codec: string | null;
  video_width: number | null;
  video_height: number | null;
  video_fps: number | null;
  audio_codec: string | null;
  audio_channels: number | null;
  r2_key: string;
  poster_r2_key: string | null;
  file_size: number | null;
  created_at: string;
}

// User data (resume position, watched, favorites)
export interface UserData {
  user_id: string;
  item_id: string;
  item_type: 'movie' | 'episode';
  is_favorite: number;
  played: number;
  playback_position: number;
  last_played_at: string | null;
}

// Library
export interface Library {
  id: string;
  name: string;
  type: 'movies' | 'tvshows';
  path_prefix: string;
  created_at: string;
}

// JWT payload
export interface JWTPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}

// Authenticated request context
export interface AuthenticatedContext {
  user: User;
  params: Record<string, string>;
  request: Request;
}
```

### 2.2 Authentication

Create `worker/src/auth.ts`:

```typescript
import { type Env, type User, type JWTPayload } from './types';
import * as queries from './db/queries';

const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days

export async function authenticateUser(
  db: D1Database,
  username: string,
  password: string
): Promise<{ user: User; token: string } | null> {
  const user = await queries.getUserByUsername(db, username);
  if (!user) return null;

  // Simple password comparison (for production, use bcrypt)
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) return null;

  const token = await generateJWT(user);
  return { user, token };
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // TODO: Implement proper password hashing (bcrypt)
  // For now, simple comparison (NOT FOR PRODUCTION)
  return password === hash;
}

async function generateJWT(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    isAdmin: user.is_admin === 1,
    iat: now,
    exp: now + JWT_EXPIRY,
  };

  // Simple JWT implementation
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = await signJWT(`${header}.${body}`);

  return `${header}.${body}.${signature}`;
}

async function signJWT(data: string): Promise<string> {
  // In production, use proper HMAC with secret from env
  // For now, simple hash
  const encoder = new TextEncoder();
  const msg = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return btoa(String.fromCharCode(...hashArray));
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    // Verify signature
    const expectedSignature = await signJWT(`${header}.${body}`);
    if (signature !== expectedSignature) return null;

    const payload: JWTPayload = JSON.parse(atob(body));

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export async function requireAuth(
  request: Request,
  env: Env
): Promise<{ user: User; token: string } | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.slice(7);
  const payload = await verifyJWT(token);
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await queries.getUser(env.DB, payload.userId);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  return { user, token };
}
```

### 2.3 Database Queries

Create `worker/src/db/queries.ts` with all CRUD operations for movies, TV shows, episodes, users, etc.

### 2.4 API Handlers

Create handlers for:
- `system.ts` - Server info, public configuration
- `users.ts` - Authentication, user preferences
- `libraries.ts` - Media folders
- `movies.ts` - Movie browsing and details
- `tvshows.ts` - TV show, season, episode browsing
- `stream.ts` - Video streaming with HTTP range support
- `images.ts` - Poster and backdrop serving
- `userdata.ts` - Resume position, watched status, favorites

---

## Phase 3: CLI Scanner (Week 3-4)

### 3.1 Scanner Features

- Scan directories for movie and TV show files
- Parse filenames using standard patterns:
  - Movies: `Movie Title (2023) [1080p].mp4`
  - TV: `Show Name S01E01.mkv` or `Show Name - Season 1 Episode 1.mkv`
- Extract metadata with ffprobe (codec, resolution, duration, bitrate)
- Fetch TMDB metadata (title, plot, poster, backdrop, ratings)
- Download and upload posters/backdrops to R2
- Upload video files to R2 (with deduplication)
- Populate D1 database

### 3.2 CLI Commands

```bash
# Scan movies directory
cf-video scan:movies /path/to/movies/

# Scan TV shows directory
cf-video scan:tv /path/to/tv-shows/

# Scan both
cf-video scan:all /path/to/media/

# Add single movie
cf-video add:movie /path/to/movie.mp4 --tmdb-id 12345

# Add single episode
cf-video add:episode /path/to/episode.mkv --show-id xxx --season 1 --episode 1

# Show stats
cf-video stats

# Create user
cf-video user:create --username admin --password secret --admin

# Delete all metadata (nuke)
cf-video nuke --confirm
```

---

## Phase 4: Client Testing (Week 4-5)

### 4.1 Testing Matrix

| Client | Platform | Auth | Browse | Stream | Resume | Images |
|--------|----------|------|--------|--------|--------|--------|
| Swiftfin | iOS/tvOS | Test | Test | Test | Test | Test |
| Findroid | Android | Test | Test | Test | Test | Test |
| Streamyfin | iOS/Android | Test | Test | Test | Test | Test |
| Infuse | iOS/tvOS | Test | Test | Test | Test | Test |
| Jellyfin Web | Browser | Test | Test | Test | Test | Test |

### 4.2 Known Limitations

- No transcoding (clients must support your video format)
- No live TV/DVR
- No plugin system
- No user management beyond basic auth
- No subtitles (can be added later)

---

## Phase 5: Polish & Documentation (Week 5-6)

### 5.1 Documentation

- README with setup instructions
- API endpoint documentation (OpenAPI spec)
- Client compatibility matrix
- Cost estimation guide
- Troubleshooting guide
- Migration guide from Jellyfin/Plex

### 5.2 Features to Add

- Search functionality
- Collections/playlists
- Recently added
- Continue watching
- Favorites
- Watch statistics
- Multi-user support improvements
- Admin dashboard (web UI)

---

## Implementation Order

### Week 1: Foundation
- [ ] Project structure setup
- [ ] D1 database schema
- [ ] Basic Worker routing
- [ ] JWT authentication
- [ ] User management endpoints

### Week 2: Core API
- [ ] System info endpoints
- [ ] Library endpoints
- [ ] Movie browsing endpoints
- [ ] Basic streaming endpoint
- [ ] Image serving

### Week 3: TV Shows & CLI
- [ ] TV show browsing (shows, seasons, episodes)
- [ ] CLI scanner structure
- [ ] Filename parsing
- [ ] ffprobe metadata extraction
- [ ] TMDB API integration

### Week 4: Upload & Sync
- [ ] R2 upload with deduplication
- [ ] Poster/backdrop download & upload
- [ ] D1 population
- [ ] Full scan workflow
- [ ] CLI commands completion

### Week 5: Client Testing
- [ ] Test with Swiftfin (iOS)
- [ ] Test with Findroid (Android)
- [ ] Test with Streamyfin
- [ ] Test with Infuse
- [ ] Test with Jellyfin Web
- [ ] Fix compatibility issues

### Week 6: Polish & Launch
- [ ] User data (resume position, watched)
- [ ] Search functionality
- [ ] Recently added
- [ ] Continue watching
- [ ] Documentation
- [ ] README
- [ ] Open source release

---

## Key Technical Decisions

### Video Format Requirements

To ensure compatibility with all Jellyfin clients without transcoding:

| Setting | Recommendation | Reason |
|---------|---------------|--------|
| **Video codec** | H.264 (AVC) | Universal support |
| **Audio codec** | AAC | Universal support |
| **Container** | MP4 | Universal support |
| **Resolution** | Up to 4K | Client dependent |
| **Bitrate** | 8-20 Mbps for 1080p | Quality vs bandwidth |

**Recommendation**: Use [Tdarr](https://tdarr.io/) or [Unmanic](https://unmanic.app/) to pre-transcode your library to H.264/MP4 before uploading.

### File Naming Convention

**Movies:**
```
Movies/
  Movie Title (2020) [1080p].mp4
  Movie Title (2020) [1080p]-poster.jpg
  Movie Title (2020) [1080p]-backdrop.jpg
```

**TV Shows:**
```
TV Shows/
  Show Name/
    Season 01/
      Show Name S01E01.mkv
      Show Name S01E02.mkv
    Season 02/
      Show Name S02E01.mkv
    poster.jpg
    backdrop.jpg
```

### R2 Storage Structure

```
videos/
  movies/
    {tmdb_id}/
      {title}_{year}.mp4
      poster.jpg
      backdrop.jpg
  tv/
    {tmdb_id}/
      season_{n}/
        episode_{m}.mp4
      poster.jpg
      backdrop.jpg
```

### TMDB Integration

Use TMDB API for metadata:
- **Free tier**: 40 requests/second
- **API Key**: Required (free to obtain)
- **Endpoints**:
  - Search: `/search/movie`, `/search/tv`
  - Details: `/movie/{id}`, `/tv/{id}`
  - Images: Image CDN (no API key needed)

---

## API Endpoints to Implement

### Phase 1: Core (Required for clients)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/System/Info` | GET | Server information |
| `/System/Info/Public` | GET | Public server info (no auth) |
| `/Users/AuthenticateByName` | POST | Login |
| `/Users/Me` | GET | Current user |
| `/Library/MediaFolders` | GET | List libraries |
| `/Users/{id}/Items` | GET | Browse items |
| `/Items/{id}` | GET | Item details |
| `/Items/{id}/Images` | GET | Item images |
| `/Images/{type}/{id}` | GET | Serve image |
| `/Videos/{id}/stream` | GET | Stream video |
| `/Videos/{id}/master.m3u8` | GET | HLS manifest (if needed) |

### Phase 2: User Data

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/UserData/{itemId}` | GET | Get user data for item |
| `/UserData/{itemId}` | POST | Update user data |
| `/Users/{id}/PlayingItems/{itemId}` | POST | Report playback start |
| `/Users/{id}/PlayingItems/{itemId}/Progress` | POST | Report playback progress |
| `/Users/{id}/PlayedItems/{itemId}` | POST | Mark as played |
| `/Users/{id}/FavoriteItems/{itemId}` | POST | Add to favorites |

### Phase 3: Search & Lists

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/Items` | GET | Search with filters |
| `/Shows/{id}/Episodes` | GET | List episodes |
| `/Shows/{id}/Seasons` | GET | List seasons |
| `/Users/{id}/Items/Resume` | GET | Continue watching |
| `/Users/{id}/Items/Latest` | GET | Recently added |

---

## CLI Scanner Architecture

### Commands

```bash
# Initialize configuration
cf-video init

# Scan movies library
cf-video scan:movies /path/to/movies --library-id xxx

# Scan TV shows library
cf-video scan:tv /path/to/tv --library-id xxx

# Scan both
cf-video scan:all /path/to/media

# Add single movie with TMDB ID
cf-video add:movie /path/to/movie.mp4 --tmdb-id 12345

# Add TV episode
cf-video add:episode /path/to/episode.mkv \
  --show-id xxx \
  --season 1 \
  --episode 1

# Show library statistics
cf-video stats

# Create admin user
cf-video user:create --username admin --password secret --admin

# List all users
cf-video user:list

# Delete all metadata (DANGER)
cf-video nuke --confirm

# Rescan metadata without re-uploading
cf-video rescan
```

### Scanner Workflow

1. **Discover**: Walk directory, find video files (.mp4, .mkv, .mov, .avi)
2. **Parse**: Extract info from filename (title, year, season, episode)
3. **Probe**: Run ffprobe to get technical metadata (codec, resolution, duration)
4. **Match**: Query TMDB API to find movie/show/episode
5. **Download**: Fetch poster and backdrop images from TMDB
6. **Upload**: Upload video and images to R2
7. **Store**: Insert metadata into D1

---

## Implementation Checklist

### Week 1: Foundation
- [ ] Create project structure
- [ ] Write D1 schema
- [ ] Set up Wrangler config
- [ ] Implement basic routing
- [ ] Implement JWT authentication
- [ ] Create user management endpoints

### Week 2: Core API
- [ ] System info endpoints
- [ ] Library endpoints
- [ ] Movie browsing endpoints
- [ ] Basic streaming endpoint
- [ ] Image serving
- [ ] Error handling

### Week 3: TV Shows & CLI
- [ ] TV show browsing (shows, seasons, episodes)
- [ ] CLI project structure
- [ ] Filename parsing
- [ ] ffprobe integration
- [ ] TMDB API client

### Week 4: Upload & Sync
- [ ] R2 upload with deduplication
- [ ] Poster/backdrop handling
- [ ] D1 population
- [ ] Full scan workflow
- [ ] CLI commands completion

### Week 5: Client Testing
- [ ] Test with Swiftfin (iOS)
- [ ] Test with Findroid (Android)
- [ ] Test with Streamyfin
- [ ] Test with Infuse
- [ ] Test with Jellyfin Web
- [ ] Fix compatibility issues

### Week 6: Polish & Launch
- [ ] User data (resume position, watched)
- [ ] Search functionality
- [ ] Recently added
- [ ] Continue watching
- [ ] Documentation
- [ ] README
- [ ] Open source release

---

## Notes

### Video Compatibility

For maximum client compatibility without transcoding, ensure your library is encoded as:

- **Video**: H.264 (AVC) High Profile Level 4.1 or lower
- **Audio**: AAC-LC (stereo or 5.1)
- **Container**: MP4 (MPEG-4 Part 14)
- **Resolution**: Up to 1080p for broad compatibility, 4K for newer clients

Tools to pre-transcode:
- [Tdarr](https://tdarr.io/) — Automated transcoding with rules
- [Unmanic](https://unmanic.app/) — Simple library optimization
- [HandBrake](https://handbrake.fr/) — Manual transcoding
- FFmpeg CLI — Custom scripts

### TMDB API

- Sign up at https://www.themoviedb.org/settings/api
- Get API key (free tier: 40 requests/second)
- Use for metadata and images

### Security Considerations

- Use HTTPS only (Cloudflare provides this)
- Implement proper password hashing (bcrypt) in production
- Use JWT for authentication
- Rate limit API endpoints
- Validate all inputs
- Keep secrets (TMDB key, JWT secret) in environment variables

### Performance Optimizations

- Use D1 indexes for queries
- Cache TMDB responses locally
- Use HTTP caching headers for images
- Implement pagination for large lists
- Use Cloudflare's edge caching

---

## Success Criteria

- [ ] Can browse movies and TV shows in Swiftfin/Findroid
- [ ] Can stream video with seeking support
- [ ] Resume position syncs across devices
- [ ] Posters and backdrops display correctly
- [ ] Search works for titles
- [ ] Recently added list is accurate
- [ ] Cost stays under $5/month for personal use

---

## Future Enhancements (Post-MVP)

- [ ] Web UI (React/Vue)
- [ ] Subtitle support (SRT, ASS)
- [ ] Multi-audio track selection
- [ ] Collections/playlists
- [ ] User quotas and permissions
- [ ] Watch statistics and analytics
- [ ] Recommendations based on watch history
- [ ] Mobile apps (native)
- [ ] Chromecast/AirPlay support
- [ ] Live TV/DVR (if source available)

---

## References

- [Jellyfin API Documentation](https://api.jellyfin.org/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [TMDB API Documentation](https://developers.themoviedb.org/3)
- [Swiftfin GitHub](https://github.com/jellyfin/Swiftfin)
- [Findroid GitHub](https://github.com/jarnedemeulemeester/findroid)
- [Streamyfin GitHub](https://github.com/streamyfin/streamyfin)

---

*This plan is a living document. Update it as the project evolves.*
