import { type Env, type User, type JWTPayload } from './types';
import * as queries from './db/queries';

const JWT_EXPIRY = 7 * 24 * 60 * 60; // 7 days

export async function authenticateUser(
  db: D1Database,
  username: string,
  password: string
): Promise<{ user: User; token: string } | null> {
  const user = await queries.getUserByUsername(db, username);
  if (!user) return null;

  // Simple password comparison (for production, use bcrypt)
  const isValid = await verifyPassword(password, user.password_hash);
  if (!isValid) return null;

  const token = await generateJWT(user);
  return { user, token };
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // TODO: Implement proper password hashing (bcrypt)
  // For now, simple comparison (NOT FOR PRODUCTION)
  return password === hash;
}

async function generateJWT(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    isAdmin: user.is_admin === 1,
    iat: now,
    exp: now + JWT_EXPIRY,
  };

  // Simple JWT implementation
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  const signature = await signJWT(`${header}.${body}`);

  return `${header}.${body}.${signature}`;
}

async function signJWT(data: string): Promise<string> {
  // In production, use proper HMAC with secret from env
  // For now, simple hash
  const encoder = new TextEncoder();
  const msg = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return btoa(String.fromCharCode(...hashArray));
}

export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;

    // Verify signature
    const expectedSignature = await signJWT(`${header}.${body}`);
    if (signature !== expectedSignature) return null;

    const payload: JWTPayload = JSON.parse(atob(body));

    // Check expiration
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Extract auth token from request.
 * Jellyfin clients send tokens in various ways:
 * - X-Emby-Authorization: MediaBrowser Token="..."
 * - X-MediaBrowser-Token: ...
 * - Authorization: MediaBrowser Token="..."
 * - ?api_key=... query parameter
 */
function extractToken(request: Request): string | null {
  // Check X-MediaBrowser-Token header
  const mbToken = request.headers.get('X-MediaBrowser-Token');
  if (mbToken) return mbToken;

  // Check api_key query parameter
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('api_key') || url.searchParams.get('ApiKey');
  if (apiKey) return apiKey;

  // Check Authorization or X-Emby-Authorization header for MediaBrowser Token="..." or Bearer
  const authHeader = request.headers.get('Authorization') || request.headers.get('X-Emby-Authorization');
  if (authHeader) {
    // MediaBrowser scheme: Token="..."
    const tokenMatch = authHeader.match(/Token="([^"]+)"/);
    if (tokenMatch) return tokenMatch[1];

    // Bearer scheme
    if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  }

  return null;
}

export async function requireAuth(
  request: Request,
  env: Env
): Promise<{ user: User; token: string } | Response> {
  const token = extractToken(request);
  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await verifyJWT(token);
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await queries.getUser(env.DB, payload.userId);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  return { user, token };
}