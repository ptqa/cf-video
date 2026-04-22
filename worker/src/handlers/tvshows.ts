import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

const SERVER_ID = 'cf01de0000000000000000000000cafe';

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

      // /Shows/NextUp
      if (showId === 'NextUp') {
        return jellyfinSuccess({
          Items: [],
          TotalRecordCount: 0,
          StartIndex: 0,
        });
      }

      if (!showId) {
        const limit = parseInt(url.searchParams.get('limit') || '100');
        const startIndex = parseInt(url.searchParams.get('startIndex') || '0');
        const shows = await queries.getTVShows(env.DB, limit, startIndex);
        return jellyfinSuccess({
          Items: shows.map(s => formatTVShow(s)),
          TotalRecordCount: shows.length,
          StartIndex: startIndex,
        });
      }

      const show = await queries.getTVShow(env.DB, showId);
      if (!show) {
        return jellyfinError('Show not found', 404);
      }

      // /Shows/{id}/Seasons
      if (pathParts[2] === 'Seasons') {
        const seasons = await queries.getSeasons(env.DB, showId);
        return jellyfinSuccess({
          Items: seasons.map(s => formatSeason(s, show)),
          TotalRecordCount: seasons.length,
          StartIndex: 0,
        });
      }

      // /Shows/{id}/Episodes
      if (pathParts[2] === 'Episodes') {
        const seasonId = url.searchParams.get('seasonId');
        let episodes;
        if (seasonId) {
          episodes = await queries.getEpisodes(env.DB, seasonId);
        } else {
          episodes = await queries.getEpisodesByShow(env.DB, showId);
        }
        return jellyfinSuccess({
          Items: episodes.map(e => formatEpisode(e, show)),
          TotalRecordCount: episodes.length,
          StartIndex: 0,
        });
      }

      return jellyfinSuccess(formatTVShow(show));
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
      const show = await queries.getTVShow(env.DB, episode.show_id);
      return jellyfinSuccess(formatEpisode(episode, show));
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}

function formatTVShow(show: any): Record<string, unknown> {
  return {
    Name: show.title,
    ServerId: SERVER_ID,
    Id: show.id,
    Type: 'Series',
    IsFolder: true,
    OriginalTitle: show.original_title,
    Year: show.year,
    ProductionYear: show.year,
    Overview: show.plot,
    CommunityRating: show.rating,
    ProviderIds: {
      Tmdb: show.tmdb_id,
      Imdb: show.imdb_id,
    },
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

function formatSeason(season: any, show: any): Record<string, unknown> {
  return {
    Name: season.title || `Season ${season.season_number}`,
    ServerId: SERVER_ID,
    Id: season.id,
    SeriesId: season.show_id,
    SeriesName: show?.title || '',
    Type: 'Season',
    IsFolder: true,
    IndexNumber: season.season_number,
    Overview: season.plot,
    ProductionYear: season.year,
    UserData: {
      PlaybackPositionTicks: 0,
      PlayCount: 0,
      IsFavorite: false,
      Played: false,
      UnplayedItemCount: season.episode_count || 0,
    },
    ImageTags: season.poster_r2_key ? { Primary: 'poster' } : {},
    BackdropImageTags: [],
    ChildCount: season.episode_count,
  };
}

function formatEpisode(episode: any, show: any): Record<string, unknown> {
  return {
    Name: episode.title,
    ServerId: SERVER_ID,
    Id: episode.id,
    SeriesId: episode.show_id,
    SeriesName: show?.title || '',
    SeasonId: episode.season_id,
    Type: 'Episode',
    IsFolder: false,
    IndexNumber: episode.episode_number,
    ParentIndexNumber: episode.season_number,
    Overview: episode.plot,
    RunTimeTicks: episode.runtime ? episode.runtime * 60 * 10000000 : null,
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
