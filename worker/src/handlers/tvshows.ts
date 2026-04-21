import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleTVShows(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  switch (endpoint) {
    case 'Shows': {
      const showId = pathParts[1];
      if (!showId) {
        // List all shows
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const startIndex = parseInt(url.searchParams.get('startIndex') || '0');
        const shows = await queries.getTVShows(env.DB, limit, startIndex);
        return jellyfinSuccess({
          Items: shows.map(s => formatTVShow(s, ctx.user.id)),
          TotalRecordCount: shows.length,
          StartIndex: startIndex,
        });
      }

      // Get specific show
      const show = await queries.getTVShow(env.DB, showId);
      if (!show) {
        return jellyfinError('Show not found', 404);
      }

      // Check if requesting seasons
      if (pathParts[2] === 'Seasons') {
        const seasons = await queries.getSeasons(env.DB, showId);
        return jellyfinSuccess({
          Items: seasons.map(s => formatSeason(s, show)),
          TotalRecordCount: seasons.length,
        });
      }

      // Check if requesting episodes
      if (pathParts[2] === 'Episodes') {
        const seasonId = url.searchParams.get('seasonId');
        let episodes: Awaited<ReturnType<typeof queries.getEpisodes>>;
        if (seasonId) {
          episodes = await queries.getEpisodes(env.DB, seasonId);
        } else {
          episodes = await queries.getEpisodesByShow(env.DB, showId);
        }
        return jellyfinSuccess({
          Items: episodes.map(e => formatEpisode(e, ctx.user.id)),
          TotalRecordCount: episodes.length,
        });
      }

      return jellyfinSuccess(formatTVShow(show, ctx.user.id));
    }

    case 'Seasons': {
      const seasonId = pathParts[1];
      if (!seasonId) {
        return jellyfinError('Season ID required', 400);
      }
      const season = await queries.getSeason(env.DB, seasonId);
      if (!season) {
        return jellyfinError('Season not found', 404);
      }
      const show = await queries.getTVShow(env.DB, season.show_id);
      return jellyfinSuccess(formatSeason(season, show!));
    }

    case 'Episodes': {
      const episodeId = pathParts[1];
      if (!episodeId) {
        return jellyfinError('Episode ID required', 400);
      }
      const episode = await queries.getEpisode(env.DB, episodeId);
      if (!episode) {
        return jellyfinError('Episode not found', 404);
      }
      return jellyfinSuccess(formatEpisode(episode, ctx.user.id));
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}

function formatTVShow(show: { id: string; title: string; original_title: string | null; year: number | null; plot: string | null; tmdb_id: string | null; imdb_id: string | null; rating: number | null; poster_r2_key: string | null; backdrop_r2_key: string | null }, userId: string): Record<string, unknown> {
  return {
    Id: show.id,
    Name: show.title,
    OriginalTitle: show.original_title,
    ServerId: 'cf-video-server',
    Type: 'Series',
    Year: show.year,
    Overview: show.plot,
    ProviderIds: {
      Tmdb: show.tmdb_id,
      Imdb: show.imdb_id,
    },
    CommunityRating: show.rating,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: {
      Primary: show.poster_r2_key ? 'poster' : null,
      Backdrop: show.backdrop_r2_key ? 'backdrop' : null,
    },
  };
}

function formatSeason(season: { id: string; season_number: number; title: string | null; plot: string | null; year: number | null; poster_r2_key: string | null; episode_count: number }, show: { title: string }): Record<string, unknown> {
  return {
    Id: season.id,
    Name: season.title || `Season ${season.season_number}`,
    ServerId: 'cf-video-server',
    Type: 'Season',
    SeriesName: show.title,
    IndexNumber: season.season_number,
    Overview: season.plot,
    ProductionYear: season.year,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: {
      Primary: season.poster_r2_key ? 'poster' : null,
    },
    ChildCount: season.episode_count,
  };
}

function formatEpisode(episode: { id: string; title: string; episode_number: number; plot: string | null; runtime: number | null; poster_r2_key: string | null }, userId: string): Record<string, unknown> {
  return {
    Id: episode.id,
    Name: episode.title,
    ServerId: 'cf-video-server',
    Type: 'Episode',
    IndexNumber: episode.episode_number,
    Overview: episode.plot,
    RunTimeTicks: episode.runtime ? episode.runtime * 10000000 : null,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
    },
    ImageTags: {
      Primary: episode.poster_r2_key ? 'poster' : null,
    },
  };
}