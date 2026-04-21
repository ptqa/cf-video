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

// Jellyfin API response types
export interface JellyfinSystemInfo {
  Id: string;
  ServerName: string;
  Version: string;
  OperatingSystem: string;
  OperatingSystemDisplayName: string;
  HasUpdateAvailable: boolean;
  SupportsLibraryMonitor: boolean;
  SupportsRemoteControl: boolean;
  SupportsMediaConversion: boolean;
  EncodersContext: string;
  WebSocketPortNumber: number;
  IsInStartupWizard: boolean;
  LocalAddress: string | null;
  WanAddress: string | null;
  CustomAuthenticationProviderName: string;
  AuthenticationProvider: string;
  ServerDate: string;
  StartupWizardCompleted: boolean;
  HttpPort: number;
  HttpsPort: number;
  Certificate: string;
  CanSelfRestart: boolean;
  CanSelfUpdate: boolean;
  HasPendingRestart: boolean;
  IsShuttingDown: boolean;
  InternalEncoderPath: string;
  ItemType: string;
  SupportsContentUpload: boolean;
  SupportsSync: boolean;
  SupportsSharedDevices: boolean;
  CanArchiveMedia: boolean;
  CanDownloadContent: boolean;
  SupportsContentDeletion: boolean;
  CanSendMail: boolean;
  HasDeadToken: boolean;
  CanManageDevice: boolean;
  IsInRemoteControl: boolean;
  CanAccessLiveTv: boolean;
  CanAccessLiveTvAdmin: boolean;
  CanAccessLiveTvWithAuthorization: boolean;
  CanControlLiveTv: boolean;
  LiveTvSubscriptionStatus: string;
}