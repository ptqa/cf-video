import { type Env, type AuthenticatedContext, type User } from '../types';
import * as queries from '../db/queries';
import { authenticateUser, generateJWT } from '../auth';
import { jellyfinSuccess, jellyfinError } from './system';

export async function handleUsers(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'Users/AuthenticateByName': {
      if (ctx.request.method !== 'POST') {
        return jellyfinError('Method not allowed', 405);
      }

      const body = await ctx.request.json() as { Username?: string; Password?: string };
      const username = body.Username;
      const password = body.Password;

      if (!username || !password) {
        return jellyfinError('Username and password required', 400);
      }

      const result = await authenticateUser(env.DB, username, password);
      if (!result) {
        return jellyfinError('Invalid username or password', 401);
      }

      return jellyfinSuccess({
        User: formatUser(result.user),
        AccessToken: result.token,
        ServerId: 'cf-video-server',
      });
    }

    case 'Users/Me': {
      return jellyfinSuccess(formatUser(ctx.user));
    }

    case '': {
      // Handle GET /Users - List all users (admin only)
      if (ctx.request.method !== 'GET') {
        return jellyfinError('Method not allowed', 405);
      }

      // Check if user is admin
      if (ctx.user.is_admin !== 1) {
        return jellyfinError('Admin access required', 403);
      }

      const users = await queries.getAllUsers(env.DB);
      return jellyfinSuccess(users.map(formatUser));
    }

    case 'Public': {
      // Handle GET /Users/Public - List publicly visible users
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
        
        // Don't allow accessing special endpoints like 'Me', 'Public', 'New' as IDs
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

function formatUser(user: User): Record<string, unknown> {
  return {
    Id: user.id,
    Name: user.username,
    ServerId: 'cf-video-server',
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
    },
    Policy: {
      IsAdministrator: user.is_admin === 1,
      IsHidden: false,
      IsDisabled: false,
      BlockedTags: [],
      EnableUserPreferenceAccess: true,
      AccessSchedules: [],
      BlockUnratedItems: [],
      EnableRemoteControlOfOtherUsers: false,
      EnableSharedDeviceControl: true,
      EnableLiveTvManagement: true,
      EnableLiveTvAccess: true,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: false,
      EnableVideoPlaybackTranscoding: false,
      EnablePlaybackRemuxing: false,
      EnableContentDeletion: false,
      EnableContentDeletionFromFolders: [],
      EnableContentDownloading: false,
      EnableSyncTranscoding: false,
      EnableMediaConversion: false,
      EnabledDevices: [],
      EnableAllDevices: true,
      EnabledChannels: [],
      EnableAllChannels: false,
      EnabledFolders: [],
      EnableAllFolders: true,
      InvalidLoginAttemptCount: 0,
      LoginAttemptsBeforeLockout: 5,
      MaxActiveSessions: 0,
      EnablePublicSharing: true,
      BlockedMediaFolders: [],
      BlockedChannels: [],
      RemoteClientBitrateLimit: 0,
      ExcludedSubFolders: [],
      SimultaneousStreamLimit: 0,
      EnabledSubtitleFormats: [],
      DisabledSubtitleFormats: [],
      AllowCameraUpload: true,
      AllowSharingPersonalContent: true,
    },
  };
}