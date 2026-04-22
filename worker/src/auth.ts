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

  const token = await generateToken(user);
  return { user, token };
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // TODO: Implement proper password hashing (bcrypt)
  // For now, simple comparison (NOT FOR PRODUCTION)
  return password === hash;
}

/**
 * Generate a hex access token that encodes the user payload.
 * Format: hex(JSON payload) + "." + hex(SHA-256 signature)
 * Uses only hex characters (0-9a-f) to avoid header encoding issues.
 */
async function generateToken(user: User): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    userId: user.id,
    username: user.username,
    isAdmin: user.is_admin === 1,
    iat: now,
    exp: now + JWT_EXPIRY,
  };

  const payloadHex = toHex(JSON.stringify(payload));
  const signatureHex = await signPayload(payloadHex);

  return `${payloadHex}${signatureHex}`;
}

function toHex(str: string): string {
  const encoder = new TextEncoder();
  return Array.from(encoder.encode(str)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

async function signPayload(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    // Token = hex(payload) + hex(64-char signature)
    // Signature is always 64 hex chars (32 bytes SHA-256)
    if (token.length < 65) return null;

    const signatureHex = token.slice(-64);
    const payloadHex = token.slice(0, -64);

    // Verify signature
    const expectedSignature = await signPayload(payloadHex);
    if (signatureHex !== expectedSignature) return null;

    const payload: JWTPayload = JSON.parse(fromHex(payloadHex));

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

  const payload = await verifyToken(token);
  if (!payload) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await queries.getUser(env.DB, payload.userId);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  return { user, token };
}