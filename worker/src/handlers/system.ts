import { type Env, type AuthenticatedContext } from '../types';

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
      return jellyfinSuccess({
        Id: 'cf01de0000000000000000000000cafe',
        ServerName: env.SERVER_NAME,
        Version: env.SERVER_VERSION,
        OperatingSystem: 'Cloudflare Workers',
        OperatingSystemDisplayName: 'Cloudflare Workers',
        HasUpdateAvailable: false,
        SupportsLibraryMonitor: false,
        SupportsRemoteControl: false,
        SupportsMediaConversion: false,
        EncodersContext: '',
        WebSocketPortNumber: 0,
        IsInStartupWizard: false,
        LocalAddress: null,
        WanAddress: null,
        CustomAuthenticationProviderName: '',
        AuthenticationProvider: '',
        ServerDate: new Date().toISOString(),
        StartupWizardCompleted: true,
        HttpPort: 443,
        HttpsPort: 443,
        Certificate: '',
        CanSelfRestart: false,
        CanSelfUpdate: false,
        HasPendingRestart: false,
        IsShuttingDown: false,
        InternalEncoderPath: '',
        ItemType: 'ServerConfiguration',
      });
    }

    case 'Info/Public': {
      return jellyfinSuccess({
        LocalAddress: '',
        ServerName: env.SERVER_NAME,
        Version: '10.11.8',
        ProductName: 'Jellyfin Server',
        OperatingSystem: '',
        Id: 'cf01de0000000000000000000000cafe',
        StartupWizardCompleted: true,
      });
    }

    case 'Ping': {
      // Ping endpoint - returns server name
      return new Response(env.SERVER_NAME, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    default:
      return jellyfinError('Unknown endpoint', 404);
  }
}