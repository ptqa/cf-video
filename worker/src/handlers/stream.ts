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
  
  // Jellyfin streaming URL patterns:
  // /Videos/{id}/stream.mp4
  // /Videos/{id}/stream
  // /Audio/{id}/stream
  // /Items/{id}/Download
  const videoId = pathParts[1];
  if (!videoId) {
    return jellyfinError('Video ID required', 400);
  }

  // Look up the R2 key
  let r2Key: string | null = null;
  let contentType = 'video/mp4';
  let fileSize = 0;
  
  const movie = await queries.getMovie(env.DB, videoId);
  if (movie) {
    r2Key = movie.r2_key;
    contentType = movie.content_type || 'video/mp4';
    fileSize = movie.file_size || 0;
  } else {
    const episode = await queries.getEpisode(env.DB, videoId);
    if (episode) {
      r2Key = episode.r2_key;
      contentType = episode.content_type || 'video/mp4';
      fileSize = episode.file_size || 0;
    }
  }

  if (!r2Key) {
    return jellyfinError('Video not found', 404);
  }

  // Handle HTTP range requests for seeking
  const rangeHeader = ctx.request.headers.get('Range');

  if (rangeHeader) {
    const rangeMatch = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : undefined;

      // Use R2's native range support
      const object = await env.BUCKET.get(r2Key, {
        range: end !== undefined
          ? { offset: start, length: end - start + 1 }
          : { offset: start },
      });

      if (!object) {
        return jellyfinError('Video file not found in storage', 404);
      }

      const totalSize = object.size;
      const rangeEnd = end !== undefined ? end : totalSize - 1;
      const contentLength = rangeEnd - start + 1;

      return new Response(object.body, {
        status: 206,
        headers: {
          'Content-Type': contentType,
          'Content-Range': `bytes ${start}-${rangeEnd}/${totalSize}`,
          'Content-Length': String(contentLength),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }
  }

  // Full content response (no range requested)
  const object = await env.BUCKET.get(r2Key);
  if (!object) {
    return jellyfinError('Video file not found in storage', 404);
  }

  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(object.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}
