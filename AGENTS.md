# CF-Video Project Agent Guidelines

## Project Overview

CF-Video is a self-hosted video streaming server running entirely on Cloudflare's edge infrastructure (Workers + R2 + D1), implementing the Jellyfin API for compatibility with existing mobile, desktop, and TV clients.

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

## Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API Server | Cloudflare Worker (TypeScript) | Jellyfin API, auth, streaming |
| Database | Cloudflare D1 (SQLite) | Movies, TV shows, episodes, users, watch state |
| File Storage | Cloudflare R2 | Video files, posters, backdrops |
| Scanner/Uploader | TypeScript CLI (Bun) | Metadata extraction, TMDB fetch, R2 upload, D1 sync |
| Clients | Existing Jellyfin apps | Swiftfin, Findroid, Streamyfin, Infuse, Jellyfin Web |

## Constraints & Design Decisions

- **No transcoding** — Workers don't have FFmpeg. Files served as-is from R2. Store videos as H.264/MP4 for maximum compatibility.
- **Direct streaming** — Video streamed directly from R2 via HTTP range requests. Zero buffering in Worker memory.
- **Metadata from TMDB** — Standard, free API for movie/TV metadata and images.
- **Jellyfin API compatibility** — Implement core endpoints (~30) to support major clients.
- **Movies + TV Shows** — Support both library types with proper hierarchy.

## Cost Estimate (100GB library, 2 hours/day streaming)

| Service | Usage | Monthly Cost |
|---------|-------|-------------|
| R2 Storage | 100GB | ~$1.50 |
| Workers | ~10K req/day | Free tier |
| R2 Egress | ~6GB/day | $0 (always free) |
| D1 | ~100MB, 50K reads/day | Free tier |
| **Total** | | **~$1.50/month** |

Compare to: Jellyfin on VPS (~$5-10/month + egress fees)

## Compatible Clients

| Client | Platform | Status |
|--------|----------|--------|
| [Swiftfin](https://github.com/jellyfin/Swiftfin) | iOS/tvOS | Target |
| [Findroid](https://github.com/jarnedemeulemeester/findroid) | Android | Target |
| [Streamyfin](https://github.com/streamyfin/streamyfin) | iOS/Android | Target |
| [Infuse](https://firecore.com/infuse) | iOS/tvOS/macOS | Target |
| [Jellyfin Web](https://github.com/jellyfin/jellyfin-web) | Browser | Target |

## Development Workflow

1. **Phase 1**: Database schema, core API structure, authentication
2. **Phase 2**: Movie browsing, streaming endpoints, image serving
3. **Phase 3**: TV show support (shows, seasons, episodes)
4. **Phase 4**: User data (resume position, watched status)
5. **Phase 5**: Search, collections, advanced features
6. **Phase 6**: Client testing, polish, documentation

## File Organization

- Store videos in R2 with structure: `movies/{tmdb_id}/{title} ({year}).mp4` or `tv/{tmdb_id}/Season {s}/{title} S{s}E{e}.mp4`
- Store posters: `posters/{tmdb_id}.jpg`
- Store backdrops: `backdrops/{tmdb_id}.jpg`
- Use TMDB as source of truth for metadata

## Coding Conventions

- TypeScript for all code
- Idiomatic code with full explanatory variable names
- Smaller files over larger ones
- Proper error handling and logging
- Version constraints for dependencies
- Security best practices (secrets management, least privilege)

## Testing Strategy

- Test with real Jellyfin clients (Swiftfin, Findroid, etc.)
- Use ffprobe to verify video metadata extraction
- Verify HTTP range requests work for seeking
- Test concurrent streaming
- Monitor R2 costs and egress

## Documentation

- README with setup instructions
- API endpoint documentation
- Client compatibility matrix
- Cost estimation guide
- Troubleshooting guide

## License

MIT (same as cf-music)
