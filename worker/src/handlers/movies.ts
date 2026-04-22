import { type Env, type AuthenticatedContext, type Movie, type TVShow, type Season, type Episode } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

const MOVIES_LIBRARY_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const TV_LIBRARY_ID = 'a656b907eb3a73532e40e44b968d0225';
const SERVER_ID = 'cf01de0000000000000000000000cafe';

export async function handleMovies(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // GET /Items/Filters - return empty filters
  if (endpoint === 'Filters') {
    return jellyfinSuccess({
      Genres: [],
      Tags: [],
      OfficialRatings: [],
      Years: [],
    });
  }

  // GET /Items?parentId=...&includeItemTypes=... - list items
  if (endpoint === '' || endpoint === undefined) {
    return handleItemsList(url, ctx, env);
  }

  // GET /Items/{id} - single item details
  return handleSingleItem(endpoint.split('/')[0], url, ctx, env);
}

async function handleItemsList(
  url: URL,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const parentId = url.searchParams.get('parentId') || url.searchParams.get('ParentId');
  const includeItemTypes = url.searchParams.get('includeItemTypes') || url.searchParams.get('IncludeItemTypes');
  const searchTerm = url.searchParams.get('searchTerm') || url.searchParams.get('SearchTerm');
  const limit = parseInt(url.searchParams.get('limit') || url.searchParams.get('Limit') || '100');
  const startIndex = parseInt(url.searchParams.get('startIndex') || url.searchParams.get('StartIndex') || '0');
  const sortBy = url.searchParams.get('sortBy') || url.searchParams.get('SortBy') || '';
  const sortOrder = url.searchParams.get('sortOrder') || url.searchParams.get('SortOrder') || 'Ascending';

  let items: Record<string, unknown>[] = [];
  let totalCount = 0;

  // Handle ids parameter - fetch specific items by ID
  const ids = url.searchParams.get('ids') || url.searchParams.get('Ids');
  if (ids) {
    const idList = ids.split(',');
    for (const id of idList) {
      const movie = await queries.getMovie(env.DB, id);
      if (movie) {
        items.push(formatMovieItem(movie));
        continue;
      }
      const show = await queries.getTVShow(env.DB, id);
      if (show) {
        items.push(formatTVShowItem(show));
        continue;
      }
      const season = await queries.getSeason(env.DB, id);
      if (season) {
        items.push(formatSeasonItem(season));
        continue;
      }
      const episode = await queries.getEpisode(env.DB, id);
      if (episode) {
        items.push(formatEpisodeItem(episode));
        continue;
      }
    }
    return jellyfinSuccess({
      Items: items,
      TotalRecordCount: items.length,
      StartIndex: 0,
    });
  }

  // Search across both types
  if (searchTerm) {
    const movies = await queries.searchMovies(env.DB, searchTerm, limit);
    const shows = await queries.searchTVShows(env.DB, searchTerm, limit);
    items = [
      ...movies.map(formatMovieItem),
      ...shows.map(formatTVShowItem),
    ];
    totalCount = items.length;
    return jellyfinSuccess({
      Items: items.slice(startIndex, startIndex + limit),
      TotalRecordCount: totalCount,
      StartIndex: startIndex,
    });
  }

  // TV Shows library
  if (parentId === TV_LIBRARY_ID || includeItemTypes === 'Series') {
    const shows = await queries.getTVShows(env.DB, limit, startIndex);
    items = shows.map(formatTVShowItem);
    totalCount = await queries.getTVShowCount(env.DB);
  }

  // Movies library
  if (parentId === MOVIES_LIBRARY_ID || includeItemTypes === 'Movie') {
    const movies = await queries.getMovies(env.DB, limit, startIndex);
    items = movies.map(formatMovieItem);
    totalCount = await queries.getMovieCount(env.DB);
  }

  return jellyfinSuccess({
    Items: items,
    TotalRecordCount: totalCount,
    StartIndex: startIndex,
  });
}

async function handleSingleItem(
  itemId: string,
  url: URL,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  // Check if it's a library folder
  if (itemId === MOVIES_LIBRARY_ID) {
    return jellyfinSuccess(formatCollectionFolder('Movies', MOVIES_LIBRARY_ID, 'movies'));
  }

  if (itemId === TV_LIBRARY_ID) {
    return jellyfinSuccess(formatCollectionFolder('TV Shows', TV_LIBRARY_ID, 'tvshows'));
  }

  // Check movies
  const movie = await queries.getMovie(env.DB, itemId);
  if (movie) {
    return jellyfinSuccess(formatMovieDetail(movie));
  }

  // Check TV shows
  const show = await queries.getTVShow(env.DB, itemId);
  if (show) {
    return jellyfinSuccess(formatTVShowDetail(show));
  }

  // Check seasons
  const season = await queries.getSeason(env.DB, itemId);
  if (season) {
    const show = await queries.getTVShow(env.DB, season.show_id);
    return jellyfinSuccess(formatSeasonDetail(season, show));
  }

  // Check episodes
  const episode = await queries.getEpisode(env.DB, itemId);
  if (episode) {
    const show = await queries.getTVShow(env.DB, episode.show_id);
    return jellyfinSuccess(formatEpisodeDetail(episode, show));
  }

  return jellyfinError('Item not found', 404);
}

// ─── Shared Formatters (OpenAPI-compliant) ──────────────────────────────────

/**
 * Format a UserItemDataDto per spec. Returns default (empty) user data.
 * Real user data integration happens at the handler level when userId is available.
 */
export function formatUserItemData(
  itemId: string,
  overrides?: {
    isFavorite?: boolean;
    played?: boolean;
    playbackPositionTicks?: number;
    playCount?: number;
    lastPlayedDate?: string | null;
    unplayedItemCount?: number;
    playedPercentage?: number;
  }
): Record<string, unknown> {
  return {
    Rating: null,
    PlayedPercentage: overrides?.playedPercentage ?? null,
    UnplayedItemCount: overrides?.unplayedItemCount ?? null,
    PlaybackPositionTicks: overrides?.playbackPositionTicks ?? 0,
    PlayCount: overrides?.playCount ?? 0,
    IsFavorite: overrides?.isFavorite ?? false,
    Likes: null,
    LastPlayedDate: overrides?.lastPlayedDate ?? null,
    Played: overrides?.played ?? false,
    Key: `${itemId}`,
    ItemId: itemId,
  };
}

/**
 * Format a MediaStream per spec.
 */
function formatVideoStream(
  codec: string | null,
  width: number | null,
  height: number | null,
  fps: number | null,
  index: number
): Record<string, unknown> {
  return {
    Codec: codec,
    CodecTag: null,
    Language: null,
    ColorRange: null,
    ColorSpace: null,
    ColorTransfer: null,
    ColorPrimaries: null,
    Comment: null,
    TimeBase: null,
    CodecTimeBase: null,
    Title: null,
    VideoRange: 'Unknown',
    VideoRangeType: 'Unknown',
    AudioSpatialFormat: 'None',
    LocalizedUndefined: null,
    LocalizedDefault: null,
    LocalizedForced: null,
    LocalizedExternal: null,
    LocalizedHearingImpaired: null,
    DisplayTitle: null,
    NalLengthSize: null,
    IsInterlaced: false,
    IsAVC: null,
    ChannelLayout: null,
    BitRate: null,
    BitDepth: null,
    RefFrames: null,
    PacketLength: null,
    Channels: null,
    SampleRate: null,
    IsDefault: true,
    IsForced: false,
    IsHearingImpaired: false,
    Height: height,
    Width: width,
    AverageFrameRate: fps,
    RealFrameRate: fps,
    Profile: null,
    Type: 'Video',
    AspectRatio: null,
    Index: index,
    Score: null,
    IsExternal: false,
    DeliveryMethod: null,
    DeliveryUrl: null,
    IsExternalUrl: null,
    IsTextSubtitleStream: false,
    SupportsExternalStream: false,
    Path: null,
    PixelFormat: null,
    Level: null,
    IsAnamorphic: null,
  };
}

function formatAudioStream(
  codec: string | null,
  channels: number | null,
  index: number
): Record<string, unknown> {
  return {
    Codec: codec,
    CodecTag: null,
    Language: null,
    Comment: null,
    TimeBase: null,
    CodecTimeBase: null,
    Title: null,
    VideoRange: 'Unknown',
    VideoRangeType: 'Unknown',
    AudioSpatialFormat: 'None',
    LocalizedUndefined: null,
    LocalizedDefault: null,
    LocalizedForced: null,
    LocalizedExternal: null,
    LocalizedHearingImpaired: null,
    DisplayTitle: null,
    NalLengthSize: null,
    IsInterlaced: false,
    IsAVC: null,
    ChannelLayout: channels === 6 ? '5.1' : channels === 8 ? '7.1' : channels === 2 ? 'stereo' : null,
    BitRate: null,
    BitDepth: null,
    RefFrames: null,
    PacketLength: null,
    Channels: channels,
    SampleRate: null,
    IsDefault: true,
    IsForced: false,
    IsHearingImpaired: false,
    Height: null,
    Width: null,
    AverageFrameRate: null,
    RealFrameRate: null,
    Profile: null,
    Type: 'Audio',
    AspectRatio: null,
    Index: index,
    Score: null,
    IsExternal: false,
    DeliveryMethod: null,
    DeliveryUrl: null,
    IsExternalUrl: null,
    IsTextSubtitleStream: false,
    SupportsExternalStream: false,
    Path: null,
    PixelFormat: null,
    Level: null,
    IsAnamorphic: null,
  };
}

/**
 * Format a MediaSourceInfo per spec.
 */
export function formatMediaSource(item: {
  id: string;
  title: string;
  r2_key: string;
  container: string;
  file_size: number | null;
  runtime: number | null;
  video_codec: string | null;
  video_width: number | null;
  video_height: number | null;
  video_fps: number | null;
  audio_codec: string | null;
  audio_channels: number | null;
}): Record<string, unknown> {
  return {
    Protocol: 'File',
    Id: item.id,
    Path: item.r2_key,
    EncoderPath: null,
    EncoderProtocol: null,
    Type: 'Default',
    Container: item.container || 'mp4',
    Size: item.file_size,
    Name: item.title,
    IsRemote: false,
    ETag: null,
    RunTimeTicks: item.runtime ? item.runtime * 60 * 10_000_000 : null,
    ReadAtNativeFramerate: false,
    IgnoreDts: false,
    IgnoreIndex: false,
    GenPtsInput: false,
    SupportsTranscoding: false,
    SupportsDirectStream: true,
    SupportsDirectPlay: true,
    IsInfiniteStream: false,
    UseMostCompatibleTranscodingProfile: false,
    RequiresOpening: false,
    OpenToken: null,
    RequiresClosing: false,
    LiveStreamId: null,
    BufferMs: null,
    RequiresLooping: false,
    SupportsProbing: false,
    VideoType: 'VideoFile',
    IsoType: null,
    Video3DFormat: null,
    MediaStreams: [
      formatVideoStream(item.video_codec, item.video_width, item.video_height, item.video_fps, 0),
      formatAudioStream(item.audio_codec, item.audio_channels, 1),
    ],
    MediaAttachments: [],
    Formats: [],
    Bitrate: null,
    FallbackMaxStreamingBitrate: null,
    Timestamp: null,
    RequiredHttpHeaders: null,
    TranscodingUrl: null,
    TranscodingSubProtocol: 'http',
    TranscodingContainer: null,
    AnalyzeDurationMs: null,
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: null,
    HasSegments: false,
    DirectStreamUrl: `/Videos/${item.id}/stream.mp4?static=true`,
  };
}

/**
 * Format a CollectionFolder BaseItemDto.
 */
function formatCollectionFolder(
  name: string,
  id: string,
  collectionType: string
): Record<string, unknown> {
  return {
    Name: name,
    ServerId: SERVER_ID,
    Id: id,
    Type: 'CollectionFolder',
    CollectionType: collectionType,
    IsFolder: true,
    ImageTags: {},
    BackdropImageTags: [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    LocationType: 'FileSystem',
    MediaType: 'Unknown',
  };
}

// ─── Movie Formatters ───────────────────────────────────────────────────────

function formatMovieItem(movie: Movie): Record<string, unknown> {
  return {
    Name: movie.title,
    OriginalTitle: movie.original_title,
    ServerId: SERVER_ID,
    Id: movie.id,
    Etag: null,
    DateCreated: movie.created_at ? `${movie.created_at}Z` : null,
    CanDelete: false,
    CanDownload: true,
    Container: movie.container || 'mp4',
    SortName: movie.title?.toLowerCase(),
    PremiereDate: movie.year ? `${movie.year}-01-01T00:00:00.0000000Z` : null,
    ExternalUrls: [],
    Path: movie.r2_key,
    Overview: movie.plot,
    Taglines: [],
    Genres: [],
    CommunityRating: movie.rating,
    RunTimeTicks: movie.runtime ? movie.runtime * 60 * 10_000_000 : null,
    PlayAccess: 'Full',
    ProductionYear: movie.year,
    IsFolder: false,
    Type: 'Movie',
    People: [],
    Studios: [],
    GenreItems: [],
    ProviderIds: {
      Tmdb: movie.tmdb_id,
      Imdb: movie.imdb_id,
    },
    IsHD: movie.video_width ? movie.video_width >= 1280 : null,
    ParentId: MOVIES_LIBRARY_ID,
    UserData: formatUserItemData(movie.id),
    Tags: [],
    PrimaryImageAspectRatio: movie.poster_r2_key ? 0.6666666666666666 : null,
    ImageTags: movie.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: movie.backdrop_r2_key ? ['backdrop'] : [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    LocationType: 'FileSystem',
    MediaType: 'Video',
  };
}

function formatMovieDetail(movie: Movie): Record<string, unknown> {
  return {
    ...formatMovieItem(movie),
    MediaSources: [formatMediaSource(movie)],
    Width: movie.video_width,
    Height: movie.video_height,
  };
}

// ─── TV Show Formatters ─────────────────────────────────────────────────────

function formatTVShowItem(show: TVShow): Record<string, unknown> {
  return {
    Name: show.title,
    OriginalTitle: show.original_title,
    ServerId: SERVER_ID,
    Id: show.id,
    Etag: null,
    DateCreated: show.created_at ? `${show.created_at}Z` : null,
    CanDelete: false,
    CanDownload: false,
    SortName: show.title?.toLowerCase(),
    PremiereDate: show.year ? `${show.year}-01-01T00:00:00.0000000Z` : null,
    ExternalUrls: [],
    Overview: show.plot,
    Taglines: [],
    Genres: [],
    CommunityRating: show.rating,
    PlayAccess: 'Full',
    ProductionYear: show.year,
    IsFolder: true,
    Type: 'Series',
    People: [],
    Studios: [],
    GenreItems: [],
    ProviderIds: {
      Tmdb: show.tmdb_id,
      Imdb: show.imdb_id,
    },
    ParentId: TV_LIBRARY_ID,
    UserData: formatUserItemData(show.id, { unplayedItemCount: 0 }),
    Status: null,
    AirTime: null,
    AirDays: null,
    Tags: [],
    PrimaryImageAspectRatio: show.poster_r2_key ? 0.6666666666666666 : null,
    ImageTags: show.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: show.backdrop_r2_key ? ['backdrop'] : [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    LocationType: 'FileSystem',
    MediaType: 'Unknown',
  };
}

function formatTVShowDetail(show: TVShow): Record<string, unknown> {
  return formatTVShowItem(show);
}

// ─── Season Formatters ──────────────────────────────────────────────────────

function formatSeasonItem(season: Season, show?: TVShow | null): Record<string, unknown> {
  return {
    Name: season.title || `Season ${season.season_number}`,
    ServerId: SERVER_ID,
    Id: season.id,
    Etag: null,
    DateCreated: season.created_at ? `${season.created_at}Z` : null,
    CanDelete: false,
    CanDownload: false,
    SortName: `Season ${String(season.season_number).padStart(2, '0')}`,
    Overview: season.plot,
    IndexNumber: season.season_number,
    ProductionYear: season.year,
    IsFolder: true,
    Type: 'Season',
    ParentId: season.show_id,
    SeriesId: season.show_id,
    SeriesName: show?.title || (season as any).show_title || '',
    SeriesPrimaryImageTag: null,
    ChildCount: season.episode_count,
    UserData: formatUserItemData(season.id, { unplayedItemCount: season.episode_count || 0 }),
    Tags: [],
    PrimaryImageAspectRatio: season.poster_r2_key ? 0.6666666666666666 : null,
    ImageTags: season.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    LocationType: 'FileSystem',
    MediaType: 'Unknown',
  };
}

function formatSeasonDetail(season: Season, show?: TVShow | null): Record<string, unknown> {
  return formatSeasonItem(season, show);
}

// ─── Episode Formatters ─────────────────────────────────────────────────────

function formatEpisodeItem(episode: Episode, show?: TVShow | null): Record<string, unknown> {
  return {
    Name: episode.title,
    ServerId: SERVER_ID,
    Id: episode.id,
    Etag: null,
    DateCreated: episode.created_at ? `${episode.created_at}Z` : null,
    CanDelete: false,
    CanDownload: true,
    Container: episode.container || 'mp4',
    SortName: `Episode ${String(episode.episode_number).padStart(3, '0')}`,
    Overview: episode.plot,
    IndexNumber: episode.episode_number,
    ParentIndexNumber: (episode as any).season_number ?? null,
    RunTimeTicks: episode.runtime ? episode.runtime * 60 * 10_000_000 : null,
    ProductionYear: null,
    IsFolder: false,
    Type: 'Episode',
    ParentId: episode.season_id,
    SeriesId: episode.show_id,
    SeriesName: show?.title || '',
    SeasonId: episode.season_id,
    SeasonName: null,
    SeriesPrimaryImageTag: null,
    People: [],
    Studios: [],
    Taglines: [],
    Genres: [],
    Tags: [],
    ExternalUrls: [],
    PlayAccess: 'Full',
    UserData: formatUserItemData(episode.id),
    PrimaryImageAspectRatio: episode.poster_r2_key ? 1.7777777777777777 : null,
    ImageTags: episode.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: [],
    ScreenshotImageTags: [],
    ImageBlurHashes: {},
    LocationType: 'FileSystem',
    MediaType: 'Video',
  };
}

function formatEpisodeDetail(episode: Episode, show?: TVShow | null): Record<string, unknown> {
  return {
    ...formatEpisodeItem(episode, show),
    MediaSources: [formatMediaSource(episode)],
    Width: episode.video_width,
    Height: episode.video_height,
  };
}

// Re-export formatters for use by tvshows.ts
export {
  formatTVShowItem,
  formatTVShowDetail,
  formatSeasonItem,
  formatSeasonDetail,
  formatEpisodeItem,
  formatEpisodeDetail,
  formatMovieItem,
  formatMovieDetail,
};
