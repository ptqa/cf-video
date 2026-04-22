import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';
import {
  formatTVShowItem,
  formatSeasonItem,
  formatSeasonDetail,
  formatEpisodeItem,
  formatEpisodeDetail,
} from './movies';

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

      // /Shows/NextUp - returns BaseItemDtoQueryResult
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
        const totalCount = await queries.getTVShowCount(env.DB);
        return jellyfinSuccess({
          Items: shows.map(s => formatTVShowItem(s)),
          TotalRecordCount: totalCount,
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
          Items: seasons.map(s => formatSeasonItem(s, show)),
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
          Items: episodes.map(e => formatEpisodeItem(e, show)),
          TotalRecordCount: episodes.length,
          StartIndex: 0,
        });
      }

      // /Shows/{id} - single show detail
      return jellyfinSuccess(formatTVShowItem(show));
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
      return jellyfinSuccess(formatSeasonDetail(season, show));
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
      return jellyfinSuccess(formatEpisodeDetail(episode, show));
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}
