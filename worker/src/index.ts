import { type Env, type AuthenticatedContext } from './types';
import { requireAuth } from './auth';
import { handleSystem, jellyfinError } from './handlers/system';
import { handleUsers } from './handlers/users';
import { handleLibraries } from './handlers/libraries';
import { handleMovies } from './handlers/movies';
import { handleTVShows } from './handlers/tvshows';
import { handleStream } from './handlers/stream';
import { handleImages } from './handlers/images';
import { handleUserData } from './handlers/userdata';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      return new Response(
        JSON.stringify({ status: 'ok', server: env.SERVER_NAME, version: env.SERVER_VERSION }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Public system info (no auth required)
    if (path === '/System/Info/Public') {
      return handleSystem('System/Info/Public', {} as AuthenticatedContext, env);
    }

    // Ping endpoint (no auth required)
    if (path === '/System/Ping') {
      return handleSystem('System/Ping', {} as AuthenticatedContext, env);
    }

    // Public user list (no auth required - Jellyfin clients need this for login screen)
    if (path === '/Users/Public') {
      return handleUsers('Public', { request } as AuthenticatedContext, env);
    }

    // Authentication endpoint (no auth required)
    if (path === '/Users/AuthenticateByName') {
      return handleUsers('Users/AuthenticateByName', { request } as AuthenticatedContext, env);
    }

    // All other endpoints require authentication
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
      // Route to appropriate handler
      const response = await routeRequest(path, authContext, env);
      if (response) return response;

      return jellyfinError('Endpoint not implemented', 501);
    } catch (err) {
      console.error(`Error handling ${path}:`, err);
      return jellyfinError('Internal server error', 500);
    }
  },
};

async function routeRequest(
  path: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response | null> {
  const url = new URL(ctx.request.url);
  const pathParts = path.split('/').filter(Boolean);

  // System endpoints
  if (path.startsWith('/System/')) {
    return handleSystem(pathParts.slice(1).join('/'), ctx, env);
  }

  // User endpoints
  if (path.startsWith('/Users/')) {
    return handleUsers(pathParts.slice(1).join('/'), ctx, env);
  }

  // Library endpoints
  if (path.startsWith('/Library/')) {
    return handleLibraries(pathParts.slice(1).join('/'), ctx, env);
  }

  // Movie/Item browsing endpoints
  if (path.startsWith('/Users/') && path.includes('/Items')) {
    return handleMovies('Users/Items', ctx, env);
  }

  // Single item details
  if (pathParts[0] === 'Items' && pathParts[1]) {
    return handleMovies('Items', ctx, env);
  }

  // TV Show endpoints
  if (path.startsWith('/Shows/')) {
    return handleTVShows('Shows', ctx, env);
  }

  if (path.startsWith('/Seasons/')) {
    return handleTVShows('Seasons', ctx, env);
  }

  if (path.startsWith('/Episodes/')) {
    return handleTVShows('Episodes', ctx, env);
  }

  // Video streaming
  if (path.includes('/stream') || path.includes('/master.m3u8')) {
    return handleStream('stream', ctx, env);
  }

  // Images
  if (path.startsWith('/Images/') || path.includes('/Images')) {
    return handleImages('Images', ctx, env);
  }

  // User data (favorites, watched, resume)
  if (path.startsWith('/UserData/') || path.includes('/PlayingItems') || 
      path.includes('/PlayedItems') || path.includes('/FavoriteItems')) {
    return handleUserData('UserData', ctx, env);
  }

  return null;
}