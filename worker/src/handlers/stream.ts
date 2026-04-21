import { type Env, type AuthenticatedContext } from '../types';
import * as queries from '../db/queries';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleStream(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  const url = new URL(ctx.request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  
  // Extract video ID from path like /Videos/{id}/stream
  const videoId = pathParts[1];
  if (!videoId) {
    return jellyfinError('Video ID required', 400);
  }

  // Check if it's a movie or episode
  let r2Key: string | null = null;
  let contentType = 'video/mp4';
  
  const movie = await queries.getMovie(env.DB, videoId);
  if (movie) {
    r2Key = movie.r2_key;
    contentType = movie.content_type;
  } else {
    const episode = await queries.getEpisode(env.DB, videoId);
    if (episode) {
      r2Key = episode.r2_key;
      contentType = episode.content_type;
    }
  }

  if (!r2Key) {
    return jellyfinError('Video not found', 404);
  }

  // Get the object from R2
  const object = await env.BUCKET.get(r2Key);
  if (!object) {
    return jellyfinError('Video file not found in storage', 404);
  }

  // Handle HTTP range requests for seeking
  const rangeHeader = ctx.request.headers.get('Range');
  const objectSize = object.size;

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : objectSize - 1;
      
      const slicedBody = object.body.slice(start, end + 1);
      
      return new Response(slicedBody as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${end}/${objectSize}`,
          'Content-Length': String(end - start + 1),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
  }

  // Full content response (no range requested)
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(objectSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}