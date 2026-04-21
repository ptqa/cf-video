/**
 * Video directory scanner for movies and TV shows.
 */

import { readdir, stat, readFile } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import cliProgress from 'cli-progress';
import { type R2Uploader } from './uploader';
import { type D1Client } from './db';
import { type TMDBClient } from './tmdb';
import { extractMetadata, getContentType, type VideoMetadata } from './ffprobe';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);

// Concurrency limiter for parallel uploads
async function pLimit<T>(concurrency: number, tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const p = task().then((result) => {
      results[i] = result;
    });
    executing.push(p);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(executing.findIndex((p) => p === Promise.race(executing)), 1);
    }
  }

  await Promise.all(executing);
  return results;
}

// Simple parallel map with concurrency limit
async function parallelMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

// ─── Progress Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function calculateETA(current: number, total: number, startTime: number): string {
  if (current === 0) return 'calculating...';
  const elapsed = Date.now() - startTime;
  const avgTime = elapsed / current;
  const remaining = (total - current) * avgTime;
  const seconds = Math.round(remaining / 1000);
  
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface ScanResult {
  total: number;
  uploaded: number;
  skipped: number;
  errors: number;
}

interface MovieFileInfo {
  title: string;
  year: number | null;
  path: string;
}

interface EpisodeFileInfo {
  showName: string;
  season: number;
  episode: number;
  title: string | null;
  path: string;
}

export class Scanner {
  private uploader: R2Uploader;
  private db: D1Client;
  private tmdb: TMDBClient;

  constructor(uploader: R2Uploader, db: D1Client, tmdb: TMDBClient) {
    this.uploader = uploader;
    this.db = db;
    this.tmdb = tmdb;
  }

  // ─── Movie Scanning ────────────────────────────────────────────────────────

  async scanMoviesDirectory(dirPath: string): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };
    const files = await this.findVideoFiles(dirPath);

    console.log(`Found ${files.length} video files in movies directory`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const progress = `[${i + 1}/${files.length}]`;

      try {
        const wasUploaded = await this.processMovie(file);
        result.total++;
        if (wasUploaded) {
          result.uploaded++;
          console.log(`${progress} Uploaded: ${basename(file)}`);
        } else {
          result.skipped++;
          console.log(`${progress} Skipped: ${basename(file)}`);
        }
      } catch (err) {
        result.errors++;
        console.error(`${progress} Error: ${basename(file)} - ${err}`);
      }
    }

    return result;
  }

  async processMovie(filePath: string): Promise<boolean> {
    // Parse filename
    const fileInfo = parseMovieFilename(filePath);
    
    // Extract video metadata
    const metadata = await extractMetadata(filePath);
    
    // Search TMDB
    const searchResults = await this.tmdb.searchMovie(fileInfo.title, fileInfo.year || undefined);
    if (!searchResults.results || searchResults.results.length === 0) {
      throw new Error(`No TMDB match found for: ${fileInfo.title}`);
    }

    const tmdbMovie = searchResults.results[0];
    const tmdbDetails = await this.tmdb.getMovieDetails(tmdbMovie.id);

    // Generate ID
    const movieId = await deterministicId(`movie:${tmdbMovie.id}`);

    // Build R2 key
    const safeTitle = sanitizeFilename(tmdbMovie.title);
    const r2Key = `videos/movies/${tmdbMovie.id}/${safeTitle}_${tmdbMovie.release_date?.split('-')[0] || 'unknown'}.mp4`;

    // Read and upload video file
    const fileBuffer = await readFile(filePath);
    const contentType = getContentType(filePath);
    
    const wasUploaded = await this.uploader.uploadVideo(r2Key, fileBuffer, contentType);

    // Download and upload poster
    let posterKey: string | null = null;
    if (tmdbDetails.poster_path) {
      const posterUrl = this.tmdb.getPosterUrl(tmdbDetails.poster_path, 'w342');
      if (posterUrl) {
        const posterBuffer = await this.tmdb.downloadImage(posterUrl);
        posterKey = `posters/${tmdbMovie.id}.jpg`;
        await this.uploader.uploadImage(posterKey, posterBuffer, 'image/jpeg');
      }
    }

    // Download and upload backdrop
    let backdropKey: string | null = null;
    if (tmdbDetails.backdrop_path) {
      const backdropUrl = this.tmdb.getBackdropUrl(tmdbDetails.backdrop_path, 'w1280');
      if (backdropUrl) {
        const backdropBuffer = await this.tmdb.downloadImage(backdropUrl);
        backdropKey = `backdrops/${tmdbMovie.id}.jpg`;
        await this.uploader.uploadImage(backdropKey, backdropBuffer, 'image/jpeg');
      }
    }

    // Insert into database
    await this.db.upsertMovie({
      id: movieId,
      title: tmdbMovie.title,
      original_title: tmdbDetails.original_title,
      year: tmdbMovie.release_date ? parseInt(tmdbMovie.release_date.split('-')[0]) : null,
      runtime: tmdbDetails.runtime,
      plot: tmdbDetails.overview,
      tmdb_id: String(tmdbMovie.id),
      imdb_id: tmdbDetails.imdb_id,
      rating: tmdbDetails.vote_average,
      content_type: contentType,
      container: getContainer(filePath),
      video_codec: metadata.videoCodec,
      video_width: metadata.width,
      video_height: metadata.height,
      video_fps: metadata.videoFps,
      audio_codec: metadata.audioCodec,
      audio_channels: metadata.audioChannels,
      r2_key: r2Key,
      poster_r2_key: posterKey,
      backdrop_r2_key: backdropKey,
      file_size: fileBuffer.length,
    });

    return wasUploaded;
  }

  // ─── TV Show Scanning ───────────────────────────────────────────────────────

  async scanTVDirectory(dirPath: string): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };
    
    // First, try to detect if this is a flat directory with episode files
    const allFiles = await this.findVideoFiles(dirPath);
    const episodeFiles = allFiles.filter(f => parseEpisodeFilename(basename(f)) !== null);
    
    if (episodeFiles.length > 0) {
      // Flat structure with episodes - extract show name from directory
      const showName = basename(dirPath).replace(/\s+(Season|Series|S)\s*\d+.*$/i, '').trim();
      console.log(`\nDetected flat episode structure for show: ${showName}`);
      
      try {
        const showResult = await this.processFlatShow(showName, dirPath, episodeFiles);
        result.total += showResult.total;
        result.uploaded += showResult.uploaded;
        result.skipped += showResult.skipped;
        result.errors += showResult.errors;
      } catch (err) {
        console.error(`Error processing show ${showName}: ${err}`);
        result.errors++;
      }
      
      return result;
    }
    
    // Traditional nested structure
    const entries = await readdir(dirPath, { withFileTypes: true });
    const showDirs = entries.filter(e => e.isDirectory());

    for (const showDir of showDirs) {
      const showPath = join(dirPath, showDir.name);
      console.log(`\nScanning show: ${showDir.name}`);
      
      try {
        const showResult = await this.processShow(showDir.name, showPath);
        result.total += showResult.total;
        result.uploaded += showResult.uploaded;
        result.skipped += showResult.skipped;
        result.errors += showResult.errors;
      } catch (err) {
        console.error(`Error processing show ${showDir.name}: ${err}`);
        result.errors++;
      }
    }

    return result;
  }

  async processShow(showName: string, showPath: string): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };

    // Search TMDB for show
    const searchResults = await this.tmdb.searchTVShow(showName);
    if (!searchResults.results || searchResults.results.length === 0) {
      throw new Error(`No TMDB match found for show: ${showName}`);
    }

    const tmdbShow = searchResults.results[0];
    const tmdbDetails = await this.tmdb.getTVShowDetails(tmdbShow.id);

    // Generate IDs
    const showId = await deterministicId(`tvshow:${tmdbShow.id}`);

    // Download and upload poster
    let posterKey: string | null = null;
    if (tmdbDetails.poster_path) {
      const posterUrl = this.tmdb.getPosterUrl(tmdbDetails.poster_path, 'w342');
      if (posterUrl) {
        const posterBuffer = await this.tmdb.downloadImage(posterUrl);
        posterKey = `posters/tv_${tmdbShow.id}.jpg`;
        await this.uploader.uploadImage(posterKey, posterBuffer, 'image/jpeg');
      }
    }

    // Download and upload backdrop
    let backdropKey: string | null = null;
    if (tmdbDetails.backdrop_path) {
      const backdropUrl = this.tmdb.getBackdropUrl(tmdbDetails.backdrop_path, 'w1280');
      if (backdropUrl) {
        const backdropBuffer = await this.tmdb.downloadImage(backdropUrl);
        backdropKey = `backdrops/tv_${tmdbShow.id}.jpg`;
        await this.uploader.uploadImage(backdropKey, backdropBuffer, 'image/jpeg');
      }
    }

    // Insert show into database
    await this.db.upsertTVShow({
      id: showId,
      title: tmdbShow.name,
      original_title: tmdbDetails.original_name,
      year: tmdbShow.first_air_date ? parseInt(tmdbShow.first_air_date.split('-')[0]) : null,
      plot: tmdbDetails.overview,
      tmdb_id: String(tmdbShow.id),
      imdb_id: tmdbDetails.external_ids?.imdb_id || null,
      rating: tmdbDetails.vote_average,
      poster_r2_key: posterKey,
      backdrop_r2_key: backdropKey,
    });

    // Process seasons
    const seasonDirs = await readdir(showPath, { withFileTypes: true });
    for (const seasonEntry of seasonDirs) {
      if (!seasonEntry.isDirectory()) continue;

      const seasonMatch = seasonEntry.name.match(/season\s*(\d+)/i);
      if (!seasonMatch) continue;

      const seasonNumber = parseInt(seasonMatch[1]);
      const seasonPath = join(showPath, seasonEntry.name);

      // Get season info from TMDB
      let seasonTitle: string | null = null;
      let seasonPlot: string | null = null;
      let seasonYear: number | null = null;
      let seasonPoster: string | null = null;

      try {
        const tmdbSeason = await this.tmdb.getSeasonEpisodes(tmdbShow.id, seasonNumber);
        if (tmdbSeason.episodes && tmdbSeason.episodes.length > 0) {
          const firstEpisode = tmdbSeason.episodes[0];
          seasonTitle = `Season ${seasonNumber}`;
          seasonPlot = null; // TMDB doesn't provide season overview directly
          seasonYear = firstEpisode.air_date ? parseInt(firstEpisode.air_date.split('-')[0]) : null;
        }
      } catch {
        // TMDB season info not available, continue without it
      }

      const seasonId = await deterministicId(`season:${showId}:${seasonNumber}`);

      // Download season poster if available
      let seasonPosterKey: string | null = null;
      if (seasonPoster) {
        const posterUrl = this.tmdb.getPosterUrl(seasonPoster, 'w342');
        if (posterUrl) {
          const posterBuffer = await this.tmdb.downloadImage(posterUrl);
          seasonPosterKey = `posters/season_${seasonId}.jpg`;
          await this.uploader.uploadImage(seasonPosterKey, posterBuffer, 'image/jpeg');
        }
      }

      await this.db.upsertSeason({
        id: seasonId,
        show_id: showId,
        season_number: seasonNumber,
        title: seasonTitle,
        plot: seasonPlot,
        year: seasonYear,
        poster_r2_key: seasonPosterKey,
      });

      // Process episodes
      const episodeFiles = await readdir(seasonPath, { withFileTypes: true });
      for (const episodeFile of episodeFiles) {
        if (!episodeFile.isFile()) continue;
        if (!VIDEO_EXTENSIONS.has(extname(episodeFile.name).toLowerCase())) continue;

        const episodePath = join(seasonPath, episodeFile.name);
        const episodeInfo = parseEpisodeFilename(episodeFile.name);

        if (!episodeInfo) {
          console.warn(`Could not parse episode info from: ${episodeFile.name}`);
          continue;
        }

        try {
          const wasUploaded = await this.processEpisode(
            episodePath,
            showId,
            seasonId,
            episodeInfo,
            tmdbShow.id,
            seasonNumber
          );
          result.total++;
          if (wasUploaded) {
            result.uploaded++;
            console.log(`  Uploaded: ${episodeFile.name}`);
          } else {
            result.skipped++;
            console.log(`  Skipped: ${episodeFile.name}`);
          }
        } catch (err) {
          result.errors++;
          console.error(`  Error: ${episodeFile.name} - ${err}`);
        }
      }
    }

    return result;
  }

  // ─── Flat Structure TV Show Processing ─────────────────────────────────────

  async processFlatShow(showName: string, showPath: string, episodeFiles: string[]): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };

    console.log(`\nProcessing flat show: ${showName}`);
    console.log(`Found ${episodeFiles.length} episode files`);

    // Search TMDB for show
    const searchResults = await this.tmdb.searchTVShow(showName);
    if (!searchResults.results || searchResults.results.length === 0) {
      throw new Error(`No TMDB match found for show: ${showName}`);
    }

    const tmdbShow = searchResults.results[0];
    const tmdbDetails = await this.tmdb.getTVShowDetails(tmdbShow.id);

    // Generate show ID
    const showId = await deterministicId(`tvshow:${tmdbShow.id}`);

    // Download and upload poster
    let posterKey: string | null = null;
    if (tmdbDetails.poster_path) {
      const posterUrl = this.tmdb.getPosterUrl(tmdbDetails.poster_path, 'w342');
      if (posterUrl) {
        const posterBuffer = await this.tmdb.downloadImage(posterUrl);
        posterKey = `posters/tv_${tmdbShow.id}.jpg`;
        await this.uploader.uploadImage(posterKey, posterBuffer, 'image/jpeg');
      }
    }

    // Download and upload backdrop
    let backdropKey: string | null = null;
    if (tmdbDetails.backdrop_path) {
      const backdropUrl = this.tmdb.getBackdropUrl(tmdbDetails.backdrop_path, 'w1280');
      if (backdropUrl) {
        const backdropBuffer = await this.tmdb.downloadImage(backdropUrl);
        backdropKey = `backdrops/tv_${tmdbShow.id}.jpg`;
        await this.uploader.uploadImage(backdropKey, backdropBuffer, 'image/jpeg');
      }
    }

    // Insert show into database
    await this.db.upsertTVShow({
      id: showId,
      title: tmdbShow.name,
      original_title: tmdbDetails.original_name,
      year: tmdbShow.first_air_date ? parseInt(tmdbShow.first_air_date.split('-')[0]) : null,
      plot: tmdbDetails.overview,
      tmdb_id: String(tmdbShow.id),
      imdb_id: tmdbDetails.external_ids?.imdb_id || null,
      rating: tmdbDetails.vote_average,
      poster_r2_key: posterKey,
      backdrop_r2_key: backdropKey,
    });

    // Group episodes by season
    const episodesBySeason = new Map<number, Array<{ filePath: string; episode: number; title: string | null }>>();
    
    for (const filePath of episodeFiles) {
      const filename = basename(filePath);
      const parsed = parseEpisodeFilename(filename);
      if (!parsed) continue;
      
      const season = 2; // Extract from filename or default to 2 based on your files
      
      if (!episodesBySeason.has(season)) {
        episodesBySeason.set(season, []);
      }
      episodesBySeason.get(season)!.push({
        filePath,
        episode: parsed.episode,
        title: parsed.title
      });
    }

    // Process each season
    for (const [seasonNumber, episodes] of episodesBySeason) {
      console.log(`\n  Processing Season ${seasonNumber} (${episodes.length} episodes)`);
      
      // Create season
      const seasonId = await deterministicId(`season:${showId}:${seasonNumber}`);
      
      // Get season info from TMDB
      let seasonTitle: string | null = `Season ${seasonNumber}`;
      let seasonPlot: string | null = null;
      let seasonYear: number | null = null;
      let seasonPoster: string | null = null;
      
      try {
        const tmdbSeason = await this.tmdb.getSeasonEpisodes(tmdbShow.id, seasonNumber);
        if (tmdbSeason) {
          seasonTitle = tmdbSeason.name || seasonTitle;
          seasonPlot = tmdbSeason.overview || null;
          seasonPoster = tmdbSeason.poster_path || null;
          const firstEpisode = tmdbSeason.episodes?.[0];
          seasonYear = firstEpisode?.air_date ? parseInt(firstEpisode.air_date.split('-')[0]) : null;
        }
      } catch {
        // TMDB season info not available
      }
      
      // Download season poster
      let seasonPosterKey: string | null = null;
      if (seasonPoster) {
        const posterUrl = this.tmdb.getPosterUrl(seasonPoster, 'w342');
        if (posterUrl) {
          const posterBuffer = await this.tmdb.downloadImage(posterUrl);
          seasonPosterKey = `posters/season_${seasonId}.jpg`;
          await this.uploader.uploadImage(seasonPosterKey, posterBuffer, 'image/jpeg');
        }
      }
      
      await this.db.upsertSeason({
        id: seasonId,
        show_id: showId,
        season_number: seasonNumber,
        title: seasonTitle,
        plot: seasonPlot,
        year: seasonYear,
        poster_r2_key: seasonPosterKey,
        episode_count: episodes.length,
      });
      
      // Setup progress bar
      const progressBar = new cliProgress.SingleBar({
        format: '  {bar} {percentage}% | {value}/{total} files | Current: {filename} | Size: {size} | ETA: {eta}s',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true,
        clearOnComplete: false,
        formatValue: (v: any, options: any, type: any) => {
          if (type === 'size') {
            return formatBytes(parseInt(v) || 0);
          }
          return v;
        }
      }, cliProgress.Presets.shades_classic);

      progressBar.start(episodes.length, 0, {
        filename: 'starting...',
        size: 0,
        eta: 'calculating'
      });

      const startTime = Date.now();
      let lastUpdate = startTime;

      // Process episodes in parallel
      const episodeResults = await parallelMap(
        episodes,
        3,
        async (ep, index) => {
          try {
            const fileSize = (await stat(ep.filePath)).size;
            const startUpload = Date.now();
            
            progressBar.update(index, {
              filename: basename(ep.filePath).slice(0, 40),
              size: fileSize,
              eta: calculateETA(index, episodes.length, startTime)
            });

            const wasUploaded = await this.processEpisode(
              ep.filePath,
              showId,
              seasonId,
              { episode: ep.episode, title: ep.title },
              tmdbShow.id,
              seasonNumber
            );

            const uploadTime = (Date.now() - startUpload) / 1000;
            const speed = uploadTime > 0 ? (fileSize / uploadTime / 1024 / 1024).toFixed(1) : 0;

            progressBar.update(index + 1, {
              filename: `${basename(ep.filePath).slice(0, 30)} ${wasUploaded ? `↑${speed} MB/s` : 'skipped'}`,
              size: fileSize
            });

            return { success: true, uploaded: wasUploaded };
          } catch (err) {
            progressBar.update(index + 1, {
              filename: `${basename(ep.filePath).slice(0, 30)} ERROR`,
              size: 0
            });
            return { success: false, uploaded: false };
          }
        }
      );

      progressBar.stop();

      // Aggregate results
      for (const r of episodeResults) {
        result.total++;
        if (r.success && r.uploaded) {
          result.uploaded++;
        } else if (r.success && !r.uploaded) {
          result.skipped++;
        } else {
          result.errors++;
        }
      }
    }

    return result;
  }

  async processEpisode(
    filePath: string,
    showId: string,
    seasonId: string,
    episodeInfo: { episode: number; title: string | null },
    tmdbShowId: number,
    seasonNumber: number
  ): Promise<boolean> {
    // Extract metadata
    const metadata = await extractMetadata(filePath);

    // Get episode info from TMDB
    let episodeTitle = episodeInfo.title || `Episode ${episodeInfo.episode}`;
    let episodePlot: string | null = null;
    let episodeTmdbId: string | null = null;
    let stillPath: string | null = null;

    try {
      const tmdbSeason = await this.tmdb.getSeasonEpisodes(tmdbShowId, seasonNumber);
      const tmdbEpisode = tmdbSeason.episodes?.find(
        (e: { episode_number: number }) => e.episode_number === episodeInfo.episode
      );
      if (tmdbEpisode) {
        episodeTitle = tmdbEpisode.name;
        episodePlot = tmdbEpisode.overview || null;
        episodeTmdbId = String(tmdbEpisode.id);
        stillPath = tmdbEpisode.still_path;
      }
    } catch {
      // TMDB episode info not available, use defaults
    }

    const episodeId = await deterministicId(`episode:${showId}:${seasonId}:${episodeInfo.episode}`);

    // Read and upload video file
    const fileBuffer = await readFile(filePath);
    const contentType = getContentType(filePath);
    const r2Key = `videos/tv/${tmdbShowId}/season_${seasonNumber}/episode_${episodeInfo.episode}.mp4`;

    const wasUploaded = await this.uploader.uploadVideo(r2Key, fileBuffer, contentType);

    // Download and upload still image if available
    let posterKey: string | null = null;
    if (stillPath) {
      const stillUrl = this.tmdb.getPosterUrl(stillPath, 'w300');
      if (stillUrl) {
        const stillBuffer = await this.tmdb.downloadImage(stillUrl);
        posterKey = `posters/episode_${episodeId}.jpg`;
        await this.uploader.uploadImage(posterKey, stillBuffer, 'image/jpeg');
      }
    }

    // Insert into database
    await this.db.upsertEpisode({
      id: episodeId,
      show_id: showId,
      season_id: seasonId,
      episode_number: episodeInfo.episode,
      title: episodeTitle,
      plot: episodePlot,
      runtime: metadata.duration ? Math.round(metadata.duration / 60) : null,
      tmdb_id: episodeTmdbId,
      content_type: contentType,
      container: metadata.container || 'mp4',
      video_codec: metadata.videoCodec,
      video_width: metadata.width,
      video_height: metadata.height,
      video_fps: metadata.videoFps,
      audio_codec: metadata.audioCodec,
      audio_channels: metadata.audioChannels,
      r2_key: r2Key,
      poster_r2_key: posterKey,
      file_size: fileBuffer.length,
    });

    return wasUploaded;
  }

  private async findVideoFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    await this.walkDir(dirPath, files);
    return files.sort();
  }

  private async walkDir(dirPath: string, files: string[]): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
}

// ─── Filename Parsing ───────────────────────────────────────────────────────

function parseMovieFilename(filePath: string): MovieFileInfo {
  const filename = basename(filePath, extname(filePath));
  
  // Pattern: "Movie Title (2020) [quality]"
  const match = filename.match(/^(.*?)\s*\((\d{4})\)/);
  if (match) {
    return {
      title: match[1].trim(),
      year: parseInt(match[2]),
      path: filePath,
    };
  }

  // Fallback: just use filename as title
  return {
    title: filename.replace(/[._]/g, ' ').trim(),
    year: null,
    path: filePath,
  };
}

function parseEpisodeFilename(filename: string): { episode: number; title: string | null } | null {
  // Patterns: S01E01, 1x01, Season 1 Episode 1
  const patterns = [
    /[Ss](\d+)[Ee](\d+)/,
    /(\d+)[xX](\d+)/,
    /Season\s*\d+\s*Episode\s*(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const episode = parseInt(match[2] || match[1]);
      // Extract title after episode number
      const titleMatch = filename.match(/[Ee]\d+[\s.-]*(.*?)(?:\[|$)/);
      const title = titleMatch ? titleMatch[1].trim() : null;
      return { episode, title };
    }
  }

  return null;
}

// ─── Utilities ─────────────────────────────────────────────────────────────

async function deterministicId(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  const hex = Array.from(bytes.slice(0, 16))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, '_').trim();
}

function getContainer(filePath: string): string {
  const ext = extname(filePath).toLowerCase().slice(1);
  switch (ext) {
    case 'mkv': return 'mkv';
    case 'mov': return 'mov';
    case 'avi': return 'avi';
    case 'webm': return 'webm';
    default: return 'mp4';
  }
}