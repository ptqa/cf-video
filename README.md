# CF-Video

A serverless Jellyfin-compatible video streaming server running on Cloudflare Workers + R2 + D1.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                            │
│  ┌─────────────────┐    ┌──────────┐    ┌─────────────────┐ │
│  │  Worker          │───>│  D1      │    │  R2 Bucket      │ │
│  │  (Jellyfin API)  │    │ (SQLite) │    │  (video files)  │ │
│  │                  │────────────────────>│  (posters)      │ │
│  └────────^─────────┘    └──────────┘    └─────────────────┘ │
│           │                                       ^          │
└───────────┼───────────────────────────────────────┼──────────┘
            │                                       │
    ┌───────┴─────────┐                   ┌─────────┴─────────┐
    │  Jellyfin        │                   │  CLI Scanner      │
    │  Clients         │                   │  (local, bun)     │
    │  - Swiftfin      │                   │  reads metadata   │
    │  - Findroid      │                   │  fetches TMDB     │
    │  - Streamyfin    │                   │  uploads to R2    │
    │  - Infuse        │                   │  writes to D1     │
    └─────────────────┘                   └───────────────────┘
```

## Features

- **Jellyfin API Compatible**: Works with Swiftfin, Findroid, Streamyfin, Infuse, and Jellyfin Web
- **Serverless**: Runs entirely on Cloudflare's edge infrastructure
- **Zero Egress Fees**: Video streaming via R2 has no egress costs
- **Direct Streaming**: No transcoding required (clients must support your video format)
- **Metadata from TMDB**: Automatic fetching of posters, backdrops, plots, ratings
- **Resume Position**: Track playback progress across devices

## Prerequisites

- Cloudflare account
- D1 database
- R2 bucket
- TMDB API key (free at https://www.themoviedb.org/settings/api)
- Bun runtime (for CLI)
- ffprobe (for video metadata extraction)

## Setup

### 1. Clone and Configure

```bash
git clone <repository>
cd cf-video
```

### 2. Configure CLI

Copy the example config and fill in your credentials:

```bash
cp cli/cf-video.toml.example cli/cf-video.toml
# Edit cli/cf-video.toml with your credentials
```

### 3. Install CLI Dependencies

```bash
cd cli
bun install
cd ..
```

### 4. Setup Worker

```bash
cd worker
# Install dependencies
npm install

# Setup D1 database (local)
npm run db:migrate

# Deploy worker
npm run deploy
cd ..
```

## Usage

### Scan Movies

```bash
cd cli
bun run src/index.ts scan:movies /path/to/movies
```

### Scan TV Shows

```bash
bun run src/index.ts scan:tv /path/to/tv-shows
```

### Scan Both

```bash
bun run src/index.ts scan:all /path/to/media
```

### Show Statistics

```bash
bun run src/index.ts stats
```

### Create User

```bash
bun run src/index.ts user:create --username admin --password secret --admin
```

### Delete All Data

```bash
bun run src/index.ts nuke --confirm
```

## File Naming Convention

### Movies

```
Movies/
  Movie Title (2020) [1080p].mp4
  Movie Title (2020) [1080p]-poster.jpg  (optional)
  Movie Title (2020) [1080p]-backdrop.jpg (optional)
```

### TV Shows

```
TV Shows/
  Show Name/
    Season 01/
      Show Name S01E01.mkv
      Show Name S01E02.mkv
    Season 02/
      Show Name S02E01.mkv
    poster.jpg
    backdrop.jpg
```

## Video Format Recommendations

For maximum compatibility without transcoding:

| Setting | Recommendation |
|---------|---------------|
| Video codec | H.264 (AVC) |
| Audio codec | AAC |
| Container | MP4 |
| Resolution | Up to 1080p (or 4K for newer clients) |

## Cost Estimate

For a 100GB library with 2 hours/day streaming:

| Service | Monthly Cost |
|---------|-------------|
| R2 Storage (100GB) | ~$1.50 |
| Workers | Free tier |
| R2 Egress | $0 (always free) |
| D1 | Free tier |
| **Total** | **~$1.50/month** |

## Compatible Clients

| Client | Platform | Status |
|--------|----------|--------|
| Swiftfin | iOS/tvOS | Target |
| Findroid | Android | Target |
| Streamyfin | iOS/Android | Target |
| Infuse | iOS/tvOS/macOS | Target |
| Jellyfin Web | Browser | Target |

## Development

### Worker Development

```bash
cd worker
npm run dev  # Start local dev server
```

### CLI Development

```bash
cd cli
bun run src/index.ts <command>
```

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.

## Acknowledgments

- Inspired by the Jellyfin project
- Built on Cloudflare's edge infrastructure
- TMDB for movie and TV show metadata