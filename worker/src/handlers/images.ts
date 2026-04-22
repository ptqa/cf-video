import { type Env, type AuthenticatedContext } from '../types';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleImages(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // Path format: /Images/{type}/{id} or /Items/{id}/Images
  let r2Key: string | null = null;
  let imageType = 'Primary'; // Primary, Backdrop, etc.

  if (pathParts[0] === 'Items' && pathParts[2] === 'Images') {
    // /Items/{id}/Images/Primary or /Items/{id}/Images/Backdrop/0
    const itemId = pathParts[1];
    imageType = pathParts[3] || url.searchParams.get('type') || 'Primary';
    r2Key = await findImageKey(env, itemId, imageType);
  } else if (pathParts[0] === 'Images' && pathParts.length >= 2) {
    // /Images/{type}/{id}
    imageType = pathParts[1];
    const itemId = pathParts[2];
    r2Key = await findImageKey(env, itemId, imageType);
  }

  if (!r2Key) {
    // Return a 404 or a placeholder
    return new Response('Image not found', { status: 404 });
  }

  // Get image from R2
  const object = await env.BUCKET.get(r2Key);
  if (!object) {
    return new Response('Image not found in storage', { status: 404 });
  }

  // Determine content type
  const contentType = object.httpMetadata?.contentType || 'image/jpeg';

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

async function findImageKey(env: Env, itemId: string, imageType: string): Promise<string | null> {
  // Check movies
  const { results: movies } = await env.DB.prepare(
    'SELECT poster_r2_key, backdrop_r2_key FROM movies WHERE id = ?'
  ).bind(itemId).all<{ poster_r2_key: string | null; backdrop_r2_key: string | null }>();

  if (movies.length > 0) {
    const movie = movies[0];
    if (imageType === 'Backdrop' || imageType === 'backdrops') {
      return movie.backdrop_r2_key;
    }
    return movie.poster_r2_key;
  }

  // Check TV shows
  const { results: shows } = await env.DB.prepare(
    'SELECT poster_r2_key, backdrop_r2_key FROM tv_shows WHERE id = ?'
  ).bind(itemId).all<{ poster_r2_key: string | null; backdrop_r2_key: string | null }>();

  if (shows.length > 0) {
    const show = shows[0];
    if (imageType === 'Backdrop' || imageType === 'backdrops') {
      return show.backdrop_r2_key;
    }
    return show.poster_r2_key;
  }

  // Check seasons
  const { results: seasons } = await env.DB.prepare(
    'SELECT poster_r2_key FROM seasons WHERE id = ?'
  ).bind(itemId).all<{ poster_r2_key: string | null }>();

  if (seasons.length > 0) {
    return seasons[0].poster_r2_key;
  }

  // Check episodes
  const { results: episodes } = await env.DB.prepare(
    'SELECT poster_r2_key FROM episodes WHERE id = ?'
  ).bind(itemId).all<{ poster_r2_key: string | null }>();

  if (episodes.length > 0) {
    return episodes[0].poster_r2_key;
  }

  return null;
}