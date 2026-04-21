import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleMovies(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  switch (endpoint) {
    case 'Users/Items': {
      // Check if parentId is specified
      const parentId = url.searchParams.get('parentId');
      const includeItemTypes = url.searchParams.get('includeItemTypes');
      const searchTerm = url.searchParams.get('searchTerm');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const startIndex = parseInt(url.searchParams.get('startIndex') || '0');

      let items: unknown[] = [];
      let totalCount = 0;

      if (includeItemTypes === 'Movie') {
        if (searchTerm) {
          const movies = await queries.searchMovies(env.DB, searchTerm, limit);
          items = movies.map(m => formatMovieItem(m, ctx.user.id));
          totalCount = movies.length;
        } else {
          const movies = await queries.getMovies(env.DB, limit, startIndex);
          items = movies.map(m => formatMovieItem(m, ctx.user.id));
          const countResult = await env.DB.prepare('SELECT COUNT(*) as count FROM movies').first<{ count: number }>();
          totalCount = countResult?.count || 0;
        }
      }

      return jellyfinSuccess({
        Items: items,
        TotalRecordCount: totalCount,
        StartIndex: startIndex,
      });
    }

    case 'Items': {
      // Single item details
      const itemId = pathParts[1];
      if (itemId) {
        const movie = await queries.getMovie(env.DB, itemId);
        if (movie) {
          return jellyfinSuccess(formatMovie(movie, ctx.user.id));
        }
      }
      return jellyfinError('Item not found', 404);
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}

function formatMovieItem(movie: { id: string; title: string; year: number | null; poster_r2_key: string | null; runtime: number | null }, userId: string): Record<string, unknown> {
  return {
    Id: movie.id,
    Name: movie.title,
    ServerId: 'cf-video-server',
    Type: 'Movie',
    Year: movie.year,
    RunTimeTicks: movie.runtime ? movie.runtime * 10000000 : null,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: movie.poster_r2_key ? { Primary: 'poster' } : {},
  };
}

function formatMovie(movie: { id: string; title: string; original_title: string | null; year: number | null; runtime: number | null; plot: string | null; tmdb_id: string | null; imdb_id: string | null; rating: number | null; video_codec: string | null; video_width: number | null; video_height: number | null; video_fps: number | null; audio_codec: string | null; audio_channels: number | null; poster_r2_key: string | null; backdrop_r2_key: string | null; file_size: number | null }, userId: string): Record<string, unknown> {
  return {
    Id: movie.id,
    Name: movie.title,
    OriginalTitle: movie.original_title,
    ServerId: 'cf-video-server',
    Type: 'Movie',
    Year: movie.year,
    RunTimeTicks: movie.runtime ? movie.runtime * 10000000 : null,
    Overview: movie.plot,
    ProviderIds: {
      Tmdb: movie.tmdb_id,
      Imdb: movie.imdb_id,
    },
    CommunityRating: movie.rating,
    MediaStreams: [
      {
        Type: 'Video',
        Codec: movie.video_codec,
        Width: movie.video_width,
        Height: movie.video_height,
        AverageFrameRate: movie.video_fps,
      },
      {
        Type: 'Audio',
        Codec: movie.audio_codec,
        Channels: movie.audio_channels,
      },
    ],
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: {
      Primary: movie.poster_r2_key ? 'poster' : null,
      Backdrop: movie.backdrop_r2_key ? 'backdrop' : null,
    },
    Size: movie.file_size,
  };
}