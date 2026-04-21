import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import TOML from 'toml';

export interface Config {
  cloudflare: {
    account_id: string;
    api_token: string;
  };
  r2: {
    bucket_name: string;
    endpoint: string;
    access_key_id: string;
    secret_access_key: string;
  };
  d1: {
    database_id: string;
  };
  tmdb: {
    api_key: string;
  };
}

export function loadConfig(): Config {
  const paths = [
    resolve(process.cwd(), 'cf-video.toml'),
    resolve(process.cwd(), '..', 'cf-video.toml'),
    resolve(process.env.HOME || '~', '.config', 'cf-video.toml'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      const config = TOML.parse(content) as Config;
      validateConfig(config, p);
      return config;
    }
  }

  throw new Error(
    `Config file not found. Searched:\n${paths.map(p => `  - ${p}`).join('\n')}\n\nCopy cf-video.toml.example to cf-video.toml and fill in your credentials.`
  );
}

function validateConfig(config: Config, path: string): void {
  const required = [
    ['cloudflare.account_id', config.cloudflare?.account_id],
    ['cloudflare.api_token', config.cloudflare?.api_token],
    ['r2.bucket_name', config.r2?.bucket_name],
    ['r2.endpoint', config.r2?.endpoint],
    ['r2.access_key_id', config.r2?.access_key_id],
    ['r2.secret_access_key', config.r2?.secret_access_key],
    ['d1.database_id', config.d1?.database_id],
    ['tmdb.api_key', config.tmdb?.api_key],
  ] as const;

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Missing required config in ${path}:\n${missing.map(k => `  - ${k}`).join('\n')}`);
  }
}