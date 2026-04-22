import { type Env, type AuthenticatedContext, type User } from '../types';
import * as queries from '../db/queries';
import { authenticateUser } from '../auth';
import { jellyfinSuccess, jellyfinError } from './system';

const SERVER_ID = 'cf01de0000000000000000000000cafe';

/**
 * Extract client info from the Authorization / X-Emby-Authorization header.
 * Jellyfin clients send: MediaBrowser Client="...", Device="...", DeviceId="...", Version="..."
 */
function extractClientInfo(request: Request): Record<string, string> {
  const header = request.headers.get('X-Emby-Authorization')
    || request.headers.get('Authorization')
    || '';
  const info: Record<string, string> = {};
  const matches = header.matchAll(/(\w+)="([^"]*)"/g);
  for (const match of matches) {
    info[match[1]] = match[2];
  }
  return info;
}

export async function handleUsers(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'AuthenticateByName': {
      if (ctx.request.method !== 'POST') {
        return jellyfinError('Method not allowed', 405);
      }

      // AuthenticateUserByName schema: { Username, Pw }
      const body = await ctx.request.json() as { Username?: string; Name?: string; Password?: string; Pw?: string };
      const username = body.Username || body.Name;
      const password = body.Pw ?? body.Password ?? '';

      if (!username) {
        return jellyfinError('Username required', 400);
      }

      const result = await authenticateUser(env.DB, username, password);
      if (!result) {
        return jellyfinError('Invalid username or password', 401);
      }

      const clientInfo = extractClientInfo(ctx.request);
      const sessionId = result.token.slice(0, 32);

      // AuthenticationResult schema
      return jellyfinSuccess({
        User: formatUser(result.user),
        SessionInfo: formatSessionInfo(result.user, sessionId, clientInfo),
        AccessToken: result.token,
        ServerId: SERVER_ID,
      });
    }

    case 'Me': {
      return jellyfinSuccess(formatUser(ctx.user));
    }

    case '': {
      // Handle GET /Users - List all users (admin only)
      if (ctx.request.method !== 'GET') {
        return jellyfinError('Method not allowed', 405);
      }

      if (ctx.user.is_admin !== 1) {
        return jellyfinError('Admin access required', 403);
      }

      const users = await queries.getAllUsers(env.DB);
      return jellyfinSuccess(users.map(formatUser));
    }

    case 'Public': {
      // Handle GET /Users/Public - returns array of UserDto
      if (ctx.request.method !== 'GET') {
        return jellyfinError('Method not allowed', 405);
      }

      const users = await queries.getPublicUsers(env.DB);
      return jellyfinSuccess(users.map(formatUser));
    }

    default: {
      // Handle /Users/{id}
      const pathParts = ctx.request ? new URL(ctx.request.url).pathname.split('/').filter(Boolean) : [];
      if (pathParts[0] === 'Users' && pathParts[1] && !pathParts[2]) {
        const userId = pathParts[1];

        if (['Me', 'Public', 'New', 'AuthenticateByName'].includes(userId)) {
          return jellyfinError('Unknown endpoint', 404);
        }

        const user = await queries.getUser(env.DB, userId);
        if (!user) {
          return jellyfinError('User not found', 404);
        }
        return jellyfinSuccess(formatUser(user));
      }
      return jellyfinError('Unknown endpoint', 404);
    }
  }
}

/**
 * Format a User row into a Jellyfin UserDto per the OpenAPI spec.
 */
function formatUser(user: User): Record<string, unknown> {
  return {
    Name: user.username,
    ServerId: SERVER_ID,
    ServerName: null,
    Id: user.id,
    PrimaryImageTag: null,
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    LastLoginDate: null,
    LastActivityDate: null,
    Configuration: {
      AudioLanguagePreference: '',
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: '',
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: 'Default',
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: true,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true,
      CastReceiverId: null,
    },
    Policy: {
      IsAdministrator: user.is_admin === 1,
      IsHidden: false,
      EnableCollectionManagement: false,
      EnableSubtitleManagement: false,
      EnableLyricManagement: false,
      IsDisabled: false,
      MaxParentalRating: null,
      MaxParentalSubRating: null,
      BlockedTags: [],
      AllowedTags: [],
      EnableUserPreferenceAccess: true,
      AccessSchedules: [],
      BlockUnratedItems: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: true,
      EnableRemoteAccess: true,
      EnableLiveTvManagement: false,
      EnableLiveTvAccess: false,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: false,
      EnableVideoPlaybackTranscoding: false,
      EnablePlaybackRemuxing: false,
      ForceRemoteSourceTranscoding: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnableContentDownloading: true,
      EnableSyncTranscoding: false,
      EnableMediaConversion: false,
      EnabledDevices: [],
      EnableAllDevices: true,
      EnabledChannels: [],
      EnableAllChannels: true,
      EnabledFolders: [],
      EnableAllFolders: true,
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: 5,
      MaxActiveSessions: 0,
      EnablePublicSharing: true,
      BlockedMediaFolders: [],
      BlockedChannels: [],
      RemoteClientBitrateLimit: 0,
      // Required fields per OpenAPI spec
      AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
      PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
      SyncPlayAccess: 'CreateAndJoinGroups',
    },
    PrimaryImageAspectRatio: null,
  };
}

/**
 * Format a SessionInfoDto per the OpenAPI spec.
 */
function formatSessionInfo(
  user: User,
  sessionId: string,
  clientInfo: Record<string, string>
): Record<string, unknown> {
  return {
    PlayState: {
      CanSeek: false,
      IsPaused: false,
      IsMuted: false,
      RepeatMode: 'RepeatNone',
      PlaybackOrder: 'Default',
    },
    AdditionalUsers: [],
    Capabilities: {
      PlayableMediaTypes: [],
      SupportedCommands: [],
      SupportsMediaControl: false,
      SupportsPersistentIdentifier: true,
    },
    RemoteEndPoint: null,
    PlayableMediaTypes: [],
    Id: sessionId,
    UserId: user.id,
    UserName: user.username,
    Client: clientInfo.Client || 'Unknown',
    LastActivityDate: new Date().toISOString(),
    LastPlaybackCheckIn: '0001-01-01T00:00:00.0000000Z',
    LastPausedDate: null,
    DeviceName: clientInfo.Device || 'Unknown',
    DeviceType: null,
    NowPlayingItem: null,
    NowViewingItem: null,
    DeviceId: clientInfo.DeviceId || 'unknown',
    ApplicationVersion: clientInfo.Version || '0.0.0',
    TranscodingInfo: null,
    IsActive: true,
    SupportsMediaControl: false,
    SupportsRemoteControl: false,
    NowPlayingQueue: [],
    NowPlayingQueueFullItems: [],
    HasCustomDeviceName: false,
    PlaylistItemId: null,
    ServerId: SERVER_ID,
    UserPrimaryImageTag: null,
    SupportedCommands: [],
  };
}