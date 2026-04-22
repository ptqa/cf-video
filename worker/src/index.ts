import { type Env, type AuthenticatedContext } from './types';
import { requireAuth } from './auth';
import { handleSystem, jellyfinError, jellyfinSuccess } from './handlers/system';
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

    // Log every request for debugging
    const hasToken = (request.headers.get('Authorization') || '').includes('Token=');
    console.log(`>> ${request.method} ${path} auth=${hasToken}`);

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

  // Sessions stub
  if (pathParts[0] === 'Sessions') {
    if (endpoint === 'Capabilities/Full') {
      return new Response('', { status: 204 });
    }
    return jellyfinSuccess([]);
  }

  // Items endpoints: /Items/{id}, /Items/{id}/Images, etc.
  if (pathParts[0] === 'Items') {
    return handleMovies(endpoint, ctx, env);
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

  // User data (favorites, watched, resume)
  if (path.includes('/PlayingItems') || path.includes('/PlayedItems') || path.includes('/FavoriteItems')) {
    return handleUserData(endpoint, ctx, env);
  }

  return null;
}
