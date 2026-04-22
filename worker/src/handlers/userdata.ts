import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';
import { formatUserItemData } from './movies';

/**
 * Determine whether an item ID belongs to a movie or episode.
 */
async function resolveItemType(db: D1Database, itemId: string): Promise<'movie' | 'episode'> {
  const movie = await queries.getMovie(db, itemId);
  if (movie) return 'movie';
  return 'episode';
}

/**
 * Build a UserItemDataDto from DB user_data row.
 */
function buildUserItemDataDto(
  itemId: string,
  userData: { is_favorite: number; played: number; playback_position: number; last_played_at: string | null } | null,
  runtimeTicks?: number | null
): Record<string, unknown> {
  const positionTicks = (userData?.playback_position || 0) * 10_000_000;
  let playedPercentage: number | null = null;
  if (runtimeTicks && runtimeTicks > 0 && positionTicks > 0) {
    playedPercentage = Math.min(100, (positionTicks / runtimeTicks) * 100);
  }

  return formatUserItemData(itemId, {
    isFavorite: userData?.is_favorite === 1,
    played: userData?.played === 1,
    playbackPositionTicks: positionTicks,
    playCount: userData?.played === 1 ? 1 : 0,
    lastPlayedDate: userData?.last_played_at ?? null,
    playedPercentage,
  });
}

export async function handleUserData(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // ─── Session-based playback reporting (Jellyfin 10.x spec) ─────────────

  // POST /Sessions/Playing - report playback start -> 204
  if (endpoint === 'SessionPlaying') {
    const body = await ctx.request.json() as { ItemId?: string; PositionTicks?: number };
    const itemId = body.ItemId;
    if (!itemId) return new Response('', { status: 204 });

    const itemType = await resolveItemType(env.DB, itemId);
    await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
      last_played_at: new Date().toISOString(),
    });
    return new Response('', { status: 204 });
  }

  // POST /Sessions/Playing/Progress -> 204
  if (endpoint === 'SessionProgress') {
    const body = await ctx.request.json() as { ItemId?: string; PositionTicks?: number; IsPaused?: boolean };
    const itemId = body.ItemId;
    if (!itemId) return new Response('', { status: 204 });

    const itemType = await resolveItemType(env.DB, itemId);
    if (body.PositionTicks !== undefined) {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        playback_position: Math.floor(body.PositionTicks / 10_000_000),
        last_played_at: new Date().toISOString(),
      });
    }
    return new Response('', { status: 204 });
  }

  // POST /Sessions/Playing/Stopped -> 204
  if (endpoint === 'SessionStopped') {
    const body = await ctx.request.json() as { ItemId?: string; PositionTicks?: number };
    const itemId = body.ItemId;
    if (!itemId) return new Response('', { status: 204 });

    const itemType = await resolveItemType(env.DB, itemId);
    const update: Record<string, unknown> = {
      last_played_at: new Date().toISOString(),
    };
    if (body.PositionTicks !== undefined) {
      update.playback_position = Math.floor(body.PositionTicks / 10_000_000);
    }
    await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, update);
    return new Response('', { status: 204 });
  }

  // ─── New-style endpoints (Jellyfin 10.11) ──────────────────────────────

  // POST/DELETE /UserPlayedItems/{itemId} -> returns UserItemDataDto
  if (endpoint === 'UserPlayedItems') {
    const itemId = pathParts[1];
    if (!itemId) return jellyfinError('Item ID required', 400);

    const itemType = await resolveItemType(env.DB, itemId);

    if (ctx.request.method === 'POST') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 1,
        playback_position: 0,
        last_played_at: new Date().toISOString(),
      });
    }
    if (ctx.request.method === 'DELETE') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 0,
      });
    }
    const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
    return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
  }

  // POST/DELETE /UserFavoriteItems/{itemId} -> returns UserItemDataDto
  if (endpoint === 'UserFavoriteItems') {
    const itemId = pathParts[1];
    if (!itemId) return jellyfinError('Item ID required', 400);

    const itemType = await resolveItemType(env.DB, itemId);

    if (ctx.request.method === 'POST') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 1,
      });
    }
    if (ctx.request.method === 'DELETE') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 0,
      });
    }
    const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
    return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
  }

  // ─── Legacy /UserData/{itemId} ─────────────────────────────────────────

  if (pathParts[0] === 'UserData' && pathParts[1]) {
    const itemId = pathParts[1];
    const itemType = await resolveItemType(env.DB, itemId);

    if (ctx.request.method === 'GET') {
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
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
        update.playback_position = Math.floor(body.PlaybackPositionTicks / 10_000_000);
        update.last_played_at = new Date().toISOString();
      }

      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, update);
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
    }
  }

  // ─── Legacy /Users/{id}/PlayingItems/{itemId} ──────────────────────────

  if (pathParts[0] === 'Users' && pathParts[2] === 'PlayingItems') {
    const itemId = pathParts[3];
    if (!itemId) return jellyfinError('Item ID required', 400);

    const itemType = await resolveItemType(env.DB, itemId);

    // /Users/{id}/PlayingItems/{itemId}/Progress
    if (pathParts[4] === 'Progress' && ctx.request.method === 'POST') {
      const body = await ctx.request.json() as { PositionTicks?: number };
      if (body.PositionTicks !== undefined) {
        await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
          playback_position: Math.floor(body.PositionTicks / 10_000_000),
          last_played_at: new Date().toISOString(),
        });
      }
      return new Response('', { status: 204 });
    }

    // POST /Users/{id}/PlayingItems/{itemId} - report start
    if (ctx.request.method === 'POST') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        last_played_at: new Date().toISOString(),
      });
      return new Response('', { status: 204 });
    }
  }

  // ─── Legacy /Users/{id}/PlayedItems/{itemId} ──────────────────────────

  if (pathParts[0] === 'Users' && pathParts[2] === 'PlayedItems') {
    const itemId = pathParts[3];
    if (!itemId) return jellyfinError('Item ID required', 400);

    const itemType = await resolveItemType(env.DB, itemId);

    if (ctx.request.method === 'POST') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 1,
        playback_position: 0,
        last_played_at: new Date().toISOString(),
      });
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
    }

    if (ctx.request.method === 'DELETE') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        played: 0,
      });
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
    }
  }

  // ─── Legacy /Users/{id}/FavoriteItems/{itemId} ─────────────────────────

  if (pathParts[0] === 'Users' && pathParts[2] === 'FavoriteItems') {
    const itemId = pathParts[3];
    if (!itemId) return jellyfinError('Item ID required', 400);

    const itemType = await resolveItemType(env.DB, itemId);

    if (ctx.request.method === 'POST') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 1,
      });
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
    }

    if (ctx.request.method === 'DELETE') {
      await queries.setUserData(env.DB, ctx.user.id, itemId, itemType, {
        is_favorite: 0,
      });
      const userData = await queries.getUserData(env.DB, ctx.user.id, itemId, itemType);
      return jellyfinSuccess(buildUserItemDataDto(itemId, userData));
    }
  }

  return jellyfinError('Unknown endpoint', 404);
}
