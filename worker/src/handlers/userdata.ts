import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleUserData(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Handle /UserData/{itemId}
  if (pathParts[0] === 'UserData' && pathParts[1]) {
    const itemId = pathParts[1];

    // Determine item type from query param or guess from ID prefix
    let itemType: 'movie' | 'episode' = 'movie';
    
    // Check if it's a movie or episode
    const movie = await queries.getMovie(env.DB, itemId);
    if (!movie) {
      const episode = await queries.getEpisode(env.DB, itemId);
      if (episode) {
        itemType = 'episode';
      }
    }

    if (ctx.request.method === 'GET') {
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(formatUserData(userData, itemId));
    }

    if (ctx.request.method === 'POST') {
      const body = await ctx.request.json() as {
        IsFavorite?: boolean;
        Played?: boolean;
        PlaybackPositionTicks?: number;
      };

      const update: Partial<{
        is_favorite: number;
        played: number;
        playback_position: number;
        last_played_at: string;
      }> = {};

      if (body.IsFavorite !== undefined) {
        update.is_favorite = body.IsFavorite ? 1 : 0;
      }
      if (body.Played !== undefined) {
        update.played = body.Played ? 1 : 0;
        if (body.Played) {
          update.playback_position = 0;
        }
      }
      if (body.PlaybackPositionTicks !== undefined) {
        // Convert ticks (100ns) to seconds
        update.playback_position = Math.floor(body.PlaybackPositionTicks / 10000000);
        update.last_played_at = new Date().toISOString();
      }

      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, update);
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(formatUserData(userData, itemId));
    }
  }

  // Handle /Users/{id}/PlayingItems/{itemId}
  if (pathParts[0] === 'Users' && pathParts[2] === 'PlayingItems') {
    const itemId = pathParts[3];
    if (!itemId) {
      return jellyfinError('Item ID required', 400);
    }

    // Determine item type
    let itemType: 'movie' | 'episode' = 'movie';
    const movie = await queries.getMovie(env.DB, itemId);
    if (!movie) {
      const episode = await queries.getEpisode(env.DB, itemId);
      if (episode) {
        itemType = 'episode';
      }
    }

    if (ctx.request.method === 'POST') {
      // Report playback start
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        last_played_at: new Date().toISOString(),
      });
      return jellyfinSuccess({});
    }
  }

  // Handle /Users/{id}/PlayingItems/{itemId}/Progress
  if (pathParts[0] === 'Users' && pathParts[2] === 'PlayingItems' && pathParts[4] === 'Progress') {
    const itemId = pathParts[3];
    if (!itemId) {
      return jellyfinError('Item ID required', 400);
    }

    // Determine item type
    let itemType: 'movie' | 'episode' = 'movie';
    const movie = await queries.getMovie(env.DB, itemId);
    if (!movie) {
      const episode = await queries.getEpisode(env.DB, itemId);
      if (episode) {
        itemType = 'episode';
      }
    }

    if (ctx.request.method === 'POST') {
      const body = await ctx.request.json() as { PositionTicks?: number };
      if (body.PositionTicks !== undefined) {
        await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
          playback_position: Math.floor(body.PositionTicks / 10000000),
          last_played_at: new Date().toISOString(),
        });
      }
      return jellyfinSuccess({});
    }
  }

  // Handle /Users/{id}/PlayedItems/{itemId}
  if (pathParts[0] === 'Users' && pathParts[2] === 'PlayedItems') {
    const itemId = pathParts[3];
    if (!itemId) {
      return jellyfinError('Item ID required', 400);
    }

    // Determine item type
    let itemType: 'movie' | 'episode' = 'movie';
    const movie = await queries.getMovie(env.DB, itemId);
    if (!movie) {
      const episode = await queries.getEpisode(env.DB, itemId);
      if (episode) {
        itemType = 'episode';
      }
    }

    if (ctx.request.method === 'POST') {
      // Mark as played
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 1,
        playback_position: 0,
        last_played_at: new Date().toISOString(),
      });
      return jellyfinSuccess({});
    }

    if (ctx.request.method === 'DELETE') {
      // Mark as unplayed
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 0,
      });
      return jellyfinSuccess({});
    }
  }

  // Handle /Users/{id}/FavoriteItems/{itemId}
  if (pathParts[0] === 'Users' && pathParts[2] === 'FavoriteItems') {
    const itemId = pathParts[3];
    if (!itemId) {
      return jellyfinError('Item ID required', 400);
    }

    // Determine item type
    let itemType: 'movie' | 'episode' = 'movie';
    const movie = await queries.getMovie(env.DB, itemId);
    if (!movie) {
      const episode = await queries.getEpisode(env.DB, itemId);
      if (episode) {
        itemType = 'episode';
      }
    }

    if (ctx.request.method === 'POST') {
      // Add to favorites
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 1,
      });
      return jellyfinSuccess({});
    }

    if (ctx.request.method === 'DELETE') {
      // Remove from favorites
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 0,
      });
      return jellyfinSuccess({});
    }
  }

  return jellyfinError('Unknown endpoint', 404);
}

function formatUserData(userData: { is_favorite: number; played: number; playback_position: number } | null, itemId: string): Record<string, unknown> {
  return {
    ItemId: itemId,
    IsFavorite: userData?.is_favorite === 1,
    Played: userData?.played === 1,
    PlaybackPositionTicks: (userData?.playback_position || 0) * 10000000,
  };
}