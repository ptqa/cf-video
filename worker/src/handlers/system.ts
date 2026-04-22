import { type Env, type AuthenticatedContext } from '../types';

const SERVER_ID = 'cf01de0000000000000000000000cafe';

/**
 * Jellyfin-compatible error response.
 * Uses a simple JSON object; not full ProblemDetails since most clients
 * only check HTTP status code.
 */
export function jellyfinError(message: string, status: number = 400): Response {
  return new Response(
    JSON.stringify({ Error: message }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export function jellyfinSuccess(data: unknown, status: number = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function handleSystem(
  endpoint: string,
  ctx: AuthenticatedContext,
  env: Env
): Promise<Response> {
  switch (endpoint) {
    case 'Info': {
      // Matches Jellyfin OpenAPI SystemInfo schema
      return jellyfinSuccess({
        LocalAddress: null,
        ServerName: env.SERVER_NAME,
        Version: env.SERVER_VERSION,
        ProductName: 'Jellyfin Server',
        OperatingSystem: 'Linux',
        Id: SERVER_ID,
        StartupWizardCompleted: true,
        OperatingSystemDisplayName: 'Cloudflare Workers',
        PackageName: 'cf-video',
        HasPendingRestart: false,
        IsShuttingDown: false,
        SupportsLibraryMonitor: false,
        WebSocketPortNumber: 0,
        CompletedInstallations: [],
        CanSelfRestart: false,
        CanLaunchWebBrowser: false,
        ProgramDataPath: null,
        WebPath: null,
        ItemsByNamePath: null,
        CachePath: null,
        LogPath: null,
        InternalMetadataPath: null,
        TranscodingTempPath: null,
        CastReceiverApplications: null,
        HasUpdateAvailable: false,
        EncoderLocation: null,
        SystemArchitecture: null,
      });
    }

    case 'Info/Public': {
      // Matches Jellyfin OpenAPI PublicSystemInfo schema
      return jellyfinSuccess({
        LocalAddress: null,
        ServerName: env.SERVER_NAME,
        Version: env.SERVER_VERSION,
        ProductName: 'Jellyfin Server',
        OperatingSystem: null,
        Id: SERVER_ID,
        StartupWizardCompleted: true,
      });
    }

    case 'Ping': {
      // POST /System/Ping returns "Jellyfin Server" as plain text
      return new Response('Jellyfin Server', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}