import { type Env, type AuthenticatedContext } from './types';
import { requireAuth } from './auth';
import { handleSystem, jellyfinError, jellyfinSuccess } from './handlers/system';
import { handleUsers } from './handlers/users';
import { handleLibraries } from './handlers/libraries';
import { handleMovies, formatMediaSource } from './handlers/movies';
import { handleTVShows } from './handlers/tvshows';
import { handleStream } from './handlers/stream';
import { handleImages } from './handlers/images';
import { handleUserData } from './handlers/userdata';
import * as queries from './db/queries';

const SERVER_ID = 'cf01de0000000000000000000000cafe';

/**
 * PlaybackInfoResponse per Jellyfin OpenAPI spec.
 */
async function handlePlaybackInfo(itemId: string, ctx: AuthenticatedContext, env: Env): Promise<Response> {
  let item: any = await queries.getMovie(env.DB, itemId);
  if (!item) {
    item = await queries.getEpisode(env.DB, itemId);
  }
  if (!item) {
    return jellyfinError('Item not found', 404);
  }

  return jellyfinSuccess({
    MediaSources: [formatMediaSource(item)],
    PlaySessionId: crypto.randomUUID().replace(/-/g, ''),
    ErrorCode: null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Log every request for debugging (skip noisy socket requests)
    if (path !== '/socket') {
      const hasToken = (request.headers.get('Authorization') || '').includes('Token=');
      console.log(`>> ${request.method} ${path} auth=${hasToken}`);
    }

    // Health check
    if (path === '/' || path === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', server: env.SERVER_NAME, version: env.SERVER_VERSION }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Public endpoints (no auth required) ─────────────────────────────────

    // System info
    if (path === '/System/Info/Public') {
      return handleSystem('Info/Public', {} as AuthenticatedContext, env);
    }

    // Ping
    if (path === '/System/Ping') {
      return handleSystem('Ping', {} as AuthenticatedContext, env);
    }

    // Public user list (login screen)
    if (path === '/Users/Public') {
      return handleUsers('Public', { request } as AuthenticatedContext, env);
    }

    // Authentication
    if (path === '/Users/AuthenticateByName') {
      return handleUsers('AuthenticateByName', { request } as AuthenticatedContext, env);
    }

    // Branding (login screen)
    if (path === '/Branding/Configuration') {
      return new Response(JSON.stringify({
        LoginDisclaimer: '',
        CustomCss: '',
        SplashscreenEnabled: false,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // QuickConnect
    if (path === '/QuickConnect/Enabled') {
      return new Response('false', { headers: { 'Content-Type': 'application/json' } });
    }

    // WebSocket - not supported
    if (path === '/socket') {
      return new Response('WebSocket not supported', { status: 200 });
    }

    // Images (no auth required - clients fetch without token)
    if (path.includes('/Images/')) {
      return handleImages('', { request } as AuthenticatedContext, env);
    }

    // ─── Authenticated endpoints ─────────────────────────────────────────────

    const authResult = await requireAuth(request, env);
    if (authResult instanceof Response) {
      return authResult;
    }

    const authContext: AuthenticatedContext = {
      user: authResult.user,
      params: Object.fromEntries(url.searchParams),
      request,
    };

    try {
      const response = await routeRequest(path, authContext, env);
      if (response) {
        console.log(`${request.method} ${path} -> ${response.status}`);
        return response;
      }

      console.log(`${request.method} ${path} -> 501 (not implemented)`);
      return jellyfinError('Endpoint not implemented', 501);
    } catch (err) {
      console.error(`${request.method} ${path} -> 500:`, err);
      return jellyfinError('Internal server error', 500);
    }
  },
};

async function routeRequest(
  path: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response | null> {
  // pathParts: e.g. /Users/Me -> ["Users", "Me"]
  const pathParts = path.split('/').filter(Boolean);
  // endpoint: everything after the first segment, e.g. "Me", "3a04.../Items"
  const endpoint = pathParts.slice(1).join('/');

  // System endpoints: /System/Info, /System/Ping, etc.
  if (pathParts[0] === 'System') {
    return handleSystem(endpoint, ctx, env);
  }

  // User endpoints: /Users/Me, /Users/{id}, etc.
  if (pathParts[0] === 'Users') {
    // Special case: /Users/{userId}/Items -> item browsing
    if (pathParts.length >= 3 && pathParts[2] === 'Items') {
      return handleMovies('', ctx, env);
    }
    return handleUsers(endpoint, ctx, env);
  }

  // Library endpoints
  if (pathParts[0] === 'Library') {
    return handleLibraries(endpoint, ctx, env);
  }

  // UserViews - library home screen
  if (pathParts[0] === 'UserViews') {
    return handleLibraries('UserViews', ctx, env);
  }

  // Sessions endpoints
  if (pathParts[0] === 'Sessions') {
    if (endpoint === 'Capabilities/Full') {
      return new Response('', { status: 204 });
    }
    // POST /Sessions/Playing - report playback start (204 per spec)
    if (endpoint === 'Playing' && ctx.request.method === 'POST') {
      return handleUserData('SessionPlaying', ctx, env);
    }
    // POST /Sessions/Playing/Progress - report progress (204 per spec)
    if (endpoint === 'Playing/Progress' && ctx.request.method === 'POST') {
      return handleUserData('SessionProgress', ctx, env);
    }
    // POST /Sessions/Playing/Stopped - report playback stop (204 per spec)
    if (endpoint === 'Playing/Stopped' && ctx.request.method === 'POST') {
      return handleUserData('SessionStopped', ctx, env);
    }
    return jellyfinSuccess([]);
  }

  // Video streaming: /Videos/{id}/stream, /Videos/{id}/stream.mp4
  if (pathParts[0] === 'Videos') {
    return handleStream('stream', ctx, env);
  }

  // Items endpoints: /Items/{id}, /Items/{id}/Images, etc.
  if (pathParts[0] === 'Items') {
    // /Items/{id}/Download
    if (pathParts[2] === 'Download') {
      return handleStream('stream', ctx, env);
    }
    // /Items/{id}/PlaybackInfo
    if (pathParts[2] === 'PlaybackInfo') {
      return handlePlaybackInfo(pathParts[1], ctx, env);
    }
    return handleMovies(endpoint, ctx, env);
  }

  // MediaInfo/PlaybackInfo
  if (pathParts[0] === 'MediaInfo' && pathParts[1] === 'PlaybackInfo') {
    const mediaInfoUrl = new URL(ctx.request.url);
    const itemId = mediaInfoUrl.searchParams.get('itemId') || '';
    return handlePlaybackInfo(itemId, ctx, env);
  }

  // TV Show endpoints - pass the top-level category so the handler can switch on it
  if (pathParts[0] === 'Shows') {
    return handleTVShows('Shows', ctx, env);
  }

  if (pathParts[0] === 'Seasons') {
    return handleTVShows('Seasons', ctx, env);
  }

  if (pathParts[0] === 'Episodes') {
    return handleTVShows('Episodes', ctx, env);
  }

  // Video streaming
  if (path.includes('/stream') || path.includes('/master.m3u8')) {
    return handleStream('stream', ctx, env);
  }

  // Images
  if (pathParts[0] === 'Images' || path.includes('/Images')) {
    return handleImages(endpoint, ctx, env);
  }

  // New-style user data routes per Jellyfin 10.11 spec:
  // /UserPlayedItems/{itemId} and /UserFavoriteItems/{itemId}
  if (pathParts[0] === 'UserPlayedItems') {
    return handleUserData('UserPlayedItems', ctx, env);
  }
  if (pathParts[0] === 'UserFavoriteItems') {
    return handleUserData('UserFavoriteItems', ctx, env);
  }

  // Legacy user data routes (favorites, watched, resume)
  // /Users/{id}/PlayingItems/{itemId}, /Users/{id}/PlayedItems/{itemId}, /Users/{id}/FavoriteItems/{itemId}
  if (path.includes('/PlayingItems') || path.includes('/PlayedItems') || path.includes('/FavoriteItems')) {
    return handleUserData(endpoint, ctx, env);
  }

  return null;
}
