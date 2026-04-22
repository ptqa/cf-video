import { type Env, type AuthenticatedContext } from '../types';
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
  const recursive = url.searchParams.get('recursive') === 'true';
  const sortBy = url.searchParams.get('sortBy') || url.searchParams.get('SortBy') || '';
  const sortOrder = url.searchParams.get('sortOrder') || url.searchParams.get('SortOrder') || 'Ascending';

  let items: Record<string, unknown>[] = [];
  let totalCount = 0;

  // TV Shows library
  if (parentId === TV_LIBRARY_ID || includeItemTypes === 'Series') {
    const shows = await queries.getTVShows(env.DB, limit, startIndex);
    items = shows.map(formatTVShowItem);
    const countResult = await queries.getTVShowCount(env.DB);
    totalCount = countResult;
  }

  // Movies library
  if (parentId === MOVIES_LIBRARY_ID || includeItemTypes === 'Movie') {
    const movies = await queries.getMovies(env.DB, limit, startIndex);
    items = movies.map(formatMovieItem);
    const countResult = await queries.getMovieCount(env.DB);
    totalCount = countResult;
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
    return jellyfinSuccess({
      Name: 'Movies',
      ServerId: SERVER_ID,
      Id: MOVIES_LIBRARY_ID,
      Type: 'CollectionFolder',
      CollectionType: 'movies',
      IsFolder: true,
      ImageTags: {},
      BackdropImageTags: [],
    });
  }

  if (itemId === TV_LIBRARY_ID) {
    return jellyfinSuccess({
      Name: 'TV Shows',
      ServerId: SERVER_ID,
      Id: TV_LIBRARY_ID,
      Type: 'CollectionFolder',
      CollectionType: 'tvshows',
      IsFolder: true,
      ImageTags: {},
      BackdropImageTags: [],
    });
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
    return jellyfinSuccess(formatSeasonDetail(season));
  }

  // Check episodes
  const episode = await queries.getEpisode(env.DB, itemId);
  if (episode) {
    return jellyfinSuccess(formatEpisodeDetail(episode));
  }

  return jellyfinError('Item not found', 404);
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatMovieItem(movie: any): Record<string, unknown> {
  return {
    Name: movie.title,
    ServerId: SERVER_ID,
    Id: movie.id,
    Type: 'Movie',
    CollectionType: null,
    IsFolder: false,
    Year: movie.year,
    ProductionYear: movie.year,
    RunTimeTicks: movie.runtime ? movie.runtime * 60 * 10000000 : null,
    Overview: movie.plot,
    CommunityRating: movie.rating,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
      UnplayedItemCount: 0,
    },
    ImageTags: movie.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: movie.backdrop_r2_key ? ['backdrop'] : [],
    MediaType: 'Video',
  };
}

function formatMovieDetail(movie: any): Record<string, unknown> {
  return {
    ...formatMovieItem(movie),
    OriginalTitle: movie.original_title,
    ProviderIds: {
      Tmdb: movie.tmdb_id,
      Imdb: movie.imdb_id,
    },
    MediaSources: [{
      Id: movie.id,
      Path: movie.r2_key,
      Type: 'Default',
      Container: movie.container || 'mp4',
      Size: movie.file_size,
      Name: movie.title,
      IsRemote: false,
      RunTimeTicks: movie.runtime ? movie.runtime * 60 * 10000000 : null,
      SupportsTranscoding: false,
      SupportsDirectStream: true,
      SupportsDirectPlay: true,
      IsInfiniteStream: false,
      RequiresOpening: false,
      RequiresClosing: false,
      RequiresLooping: false,
      SupportsProbing: false,
      MediaStreams: [
        {
          Codec: movie.video_codec,
          Type: 'Video',
          Width: movie.video_width,
          Height: movie.video_height,
          AverageFrameRate: movie.video_fps,
          IsDefault: true,
          Index: 0,
        },
        {
          Codec: movie.audio_codec,
          Type: 'Audio',
          Channels: movie.audio_channels,
          IsDefault: true,
          Index: 1,
        },
      ],
    }],
  };
}

function formatTVShowItem(show: any): Record<string, unknown> {
  return {
    Name: show.title,
    ServerId: SERVER_ID,
    Id: show.id,
    Type: 'Series',
    IsFolder: true,
    Year: show.year,
    ProductionYear: show.year,
    Overview: show.plot,
    CommunityRating: show.rating,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
      UnplayedItemCount: 0,
    },
    ImageTags: show.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: show.backdrop_r2_key ? ['backdrop'] : [],
    MediaType: 'Unknown',
  };
}

function formatTVShowDetail(show: any): Record<string, unknown> {
  return {
    ...formatTVShowItem(show),
    OriginalTitle: show.original_title,
    ProviderIds: {
      Tmdb: show.tmdb_id,
      Imdb: show.imdb_id,
    },
  };
}

function formatSeasonDetail(season: any): Record<string, unknown> {
  return {
    Name: season.title || `Season ${season.season_number}`,
    ServerId: SERVER_ID,
    Id: season.id,
    Type: 'Season',
    IsFolder: true,
    SeriesId: season.show_id,
    SeriesName: season.show_title || '',
    IndexNumber: season.season_number,
    Year: season.year,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
      UnplayedItemCount: season.episode_count || 0,
    },
    ImageTags: season.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: [],
  };
}

function formatEpisodeDetail(episode: any): Record<string, unknown> {
  return {
    Name: episode.title,
    ServerId: SERVER_ID,
    Id: episode.id,
    Type: 'Episode',
    IsFolder: false,
    SeriesId: episode.show_id,
    SeasonId: episode.season_id,
    IndexNumber: episode.episode_number,
    ParentIndexNumber: episode.season_number,
    RunTimeTicks: episode.runtime ? episode.runtime * 60 * 10000000 : null,
    Overview: episode.plot,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: episode.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: [],
    MediaType: 'Video',
    MediaSources: [{
      Id: episode.id,
      Path: episode.r2_key,
      Type: 'Default',
      Container: episode.container || 'mp4',
      Size: episode.file_size,
      Name: episode.title,
      IsRemote: false,
      RunTimeTicks: episode.runtime ? episode.runtime * 60 * 10000000 : null,
      SupportsTranscoding: false,
      SupportsDirectStream: true,
      SupportsDirectPlay: true,
      IsInfiniteStream: false,
      RequiresOpening: false,
      RequiresClosing: false,
      RequiresLooping: false,
      SupportsProbing: false,
      MediaStreams: [
        {
          Codec: episode.video_codec,
          Type: 'Video',
          Width: episode.video_width,
          Height: episode.video_height,
          AverageFrameRate: episode.video_fps,
          IsDefault: true,
          Index: 0,
        },
        {
          Codec: episode.audio_codec,
          Type: 'Audio',
          Channels: episode.audio_channels,
          IsDefault: true,
          Index: 1,
        },
      ],
    }],
  };
}
