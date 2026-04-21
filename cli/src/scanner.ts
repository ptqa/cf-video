/**
 * Video directory scanner for movies and TV shows.
 */

import { readdir, stat } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import cliProgress from 'cli-progress';
import { type R2Uploader, type UploadProgress } from './uploader';
import { type D1Client } from './db';
import { type TMDBClient } from './tmdb';
import { extractMetadata, getContentType, type VideoMetadata } from './ffprobe';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov', '.avi', '.webm']);

// ─── Helper Functions ─────────────────────────────────────────────────────────

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

export function parseEpisodeFilename(filename: string): { episode: number; title: string | null } | null {
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

// ─── Interfaces ───────────────────────────────────────────────────────────────

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

// ─── Scanner Class ────────────────────────────────────────────────────────────

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

    // Upload video file from disk
    const contentType = getContentType(filePath);
    const fileSize = (await stat(filePath)).size;
    
    const wasUploaded = await this.uploader.uploadVideoFile(r2Key, filePath, contentType);

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
      file_size: fileSize,
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

      // Get episode files for this season
      const episodeFiles = await this.findVideoFiles(seasonPath);
      const episodes: Array<{ filePath: string; episodeInfo: { episode: number; title: string | null } }> = [];

      for (const filePath of episodeFiles) {
        const episodeInfo = parseEpisodeFilename(basename(filePath));
        if (episodeInfo) {
          episodes.push({ filePath, episodeInfo });
        }
      }

      // Sort episodes by episode number
      episodes.sort((a, b) => a.episodeInfo.episode - b.episodeInfo.episode);

      if (episodes.length === 0) {
        console.log(`    No episodes found in ${seasonEntry.name}`);
        continue;
      }

      // Calculate total size for display
      let totalSize = 0;
      for (const ep of episodes) {
        const s = await stat(ep.filePath);
        totalSize += s.size;
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

      // Process episodes with progress
      const seasonResult = await this.processEpisodesWithProgress(
        episodes,
        showId,
        seasonId,
        tmdbShow.id,
        seasonNumber
      );

      result.total += seasonResult.total;
      result.uploaded += seasonResult.uploaded;
      result.skipped += seasonResult.skipped;
      result.errors += seasonResult.errors;
    }

    return result;
  }

  async processFlatShow(showName: string, showPath: string, episodeFiles: string[]): Promise<ScanResult> {
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

    // Group episodes by season number
    const episodesBySeason = new Map<number, Array<{ filePath: string; episodeInfo: { episode: number; title: string | null } }>>();

    for (const filePath of episodeFiles) {
      const episodeInfo = parseEpisodeFilename(basename(filePath));
      if (episodeInfo) {
        // Extract season number from filename (S01E01 -> season 1)
        const seasonMatch = basename(filePath).match(/[Ss](\d+)[Ee]\d+/);
        const seasonNumber = seasonMatch ? parseInt(seasonMatch[1]) : 1;
        
        if (!episodesBySeason.has(seasonNumber)) {
          episodesBySeason.set(seasonNumber, []);
        }
        episodesBySeason.get(seasonNumber)!.push({ filePath, episodeInfo });
      }
    }

    // Process each season
    const sortedSeasonNumbers = Array.from(episodesBySeason.keys()).sort((a, b) => a - b);

    for (const seasonNumber of sortedSeasonNumbers) {
      const episodes = episodesBySeason.get(seasonNumber)!;
      
      // Sort episodes by episode number
      episodes.sort((a, b) => a.episodeInfo.episode - b.episodeInfo.episode);

      // Get season info from TMDB
      let seasonTitle: string | null = null;
      let seasonPlot: string | null = null;
      let seasonYear: number | null = null;

      try {
        const tmdbSeason = await this.tmdb.getSeasonEpisodes(tmdbShow.id, seasonNumber);
        if (tmdbSeason.episodes && tmdbSeason.episodes.length > 0) {
          const firstEpisode = tmdbSeason.episodes[0];
          seasonTitle = `Season ${seasonNumber}`;
          seasonPlot = null;
          seasonYear = firstEpisode.air_date ? parseInt(firstEpisode.air_date.split('-')[0]) : null;
        }
      } catch {
        // TMDB season info not available, continue without it
      }

      const seasonId = await deterministicId(`season:${showId}:${seasonNumber}`);

      // Calculate total size for display
      let totalSize = 0;
      for (const ep of episodes) {
        const s = await stat(ep.filePath);
        totalSize += s.size;
      }

      await this.db.upsertSeason({
        id: seasonId,
        show_id: showId,
        season_number: seasonNumber,
        title: seasonTitle,
        plot: seasonPlot,
        year: seasonYear,
        poster_r2_key: null,
        episode_count: episodes.length,
      });

      // Process episodes with progress
      const seasonResult = await this.processEpisodesWithProgress(
        episodes,
        showId,
        seasonId,
        tmdbShow.id,
        seasonNumber
      );

      result.total += seasonResult.total;
      result.uploaded += seasonResult.uploaded;
      result.skipped += seasonResult.skipped;
      result.errors += seasonResult.errors;
    }

    return result;
  }

  async processEpisodesWithProgress(
    episodes: Array<{ filePath: string; episodeInfo: { episode: number; title: string | null } }>,
    showId: string,
    seasonId: string,
    tmdbShowId: number,
    seasonNumber: number
  ): Promise<ScanResult> {
    const result: ScanResult = { total: 0, uploaded: 0, skipped: 0, errors: 0 };

    // Calculate total size of all episodes
    let totalSize = 0;
    const fileSizes: Map<string, number> = new Map();
    for (const ep of episodes) {
      const s = await stat(ep.filePath);
      totalSize += s.size;
      fileSizes.set(ep.filePath, s.size);
    }

    // Create a MultiBar with 3 file progress bars + 1 overall bar
    const multiBar = new cliProgress.MultiBar({
      format: '{bar} {percentage}% | {filename} | {size} | {speed}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      clearOnComplete: true,
      stopOnComplete: true,
      linewrap: false,
    }, cliProgress.Presets.shades_classic);

    // Create overall progress bar
    const overallBar = multiBar.create(episodes.length, 0, {
      filename: 'Overall Progress',
      size: formatBytes(totalSize),
      speed: ''
    });

    // Create individual file progress bars (3 for concurrency)
    const fileBars = Array(3).fill(null).map((_, i) => {
      return multiBar.create(100, 0, {
        filename: `Waiting...`,
        size: '',
        speed: ''
      });
    });

    const startTime = Date.now();

    // Process episodes in parallel with progress bars
    const episodeResults = await parallelMap(
      episodes,
      3,
      async (ep, index) => {
        const workerIndex = index % 3;
        const bar = fileBars[workerIndex];
        const fileName = basename(ep.filePath).slice(0, 35);
        
        try {
          const fileSize = fileSizes.get(ep.filePath) || 0;
          
          // Check if already exists (HEAD request)
          const r2Key = `videos/tv/${tmdbShowId}/season_${seasonNumber}/episode_${ep.episodeInfo.episode}.mp4`;
          
          if (await this.uploader.exists(r2Key, fileSize)) {
            bar.update(100, {
              filename: `${fileName} (skipped)`,
              size: formatBytes(fileSize),
              speed: 'already exists'
            });
            overallBar.increment(1);
            return { success: true, uploaded: false };
          }

          bar.update(0, {
            filename: `${fileName}`,
            size: formatBytes(fileSize),
            speed: 'starting...'
          });

          // Upload from disk with progress (no readFile, streams parts from disk)
          const wasUploaded = await this.uploader.uploadVideoFile(
            r2Key,
            ep.filePath,
            getContentType(ep.filePath),
            (progress) => {
              const speedMB = (progress.speed / 1024 / 1024).toFixed(1);
              bar.update(progress.percent, {
                filename: `${fileName}`,
                size: `${formatBytes(progress.loaded)}/${formatBytes(progress.total)}`,
                speed: `${speedMB} MB/s`
              });
            }
          );

          // Insert episode into database after successful upload
          await this.processEpisodeDB(
            ep.filePath,
            showId,
            seasonId,
            ep.episodeInfo,
            tmdbShowId,
            seasonNumber,
            r2Key,
            fileSize
          );

          overallBar.increment(1);
          return { success: true, uploaded: wasUploaded };
        } catch (err) {
          bar.update(0, {
            filename: `${fileName} ERROR`,
            size: '',
            speed: String(err).slice(0, 30)
          });
          return { success: false, uploaded: false };
        }
      }
    );

    multiBar.stop();

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

    return result;
  }

  async processEpisodeDB(
    filePath: string,
    showId: string,
    seasonId: string,
    episodeInfo: { episode: number; title: string | null },
    tmdbShowId: number,
    seasonNumber: number,
    r2Key: string,
    fileSize: number
  ): Promise<void> {
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
      content_type: getContentType(filePath),
      container: metadata.container || 'mp4',
      video_codec: metadata.videoCodec,
      video_width: metadata.width,
      video_height: metadata.height,
      video_fps: metadata.videoFps,
      audio_codec: metadata.audioCodec,
      audio_channels: metadata.audioChannels,
      r2_key: r2Key,
      poster_r2_key: posterKey,
      file_size: fileSize,
    });
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
