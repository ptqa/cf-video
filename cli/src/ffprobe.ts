/**
 * ffprobe integration for extracting video metadata.
 * Requires ffprobe to be installed on the system.
 */

import { spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(spawn);

export interface VideoMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  videoFps: number | null;
  audioCodec: string | null;
  audioChannels: number | null;
  container: string | null;
  bitrate: number | null;
}

export async function extractMetadata(filePath: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,bit_rate',
      '-show_entries', 'format=duration,bit_rate,format_name',
      '-of', 'json',
      filePath,
    ]);

    let output = '';
    let errorOutput = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${errorOutput}`));
        return;
      }

      try {
        const data = JSON.parse(output);
        const stream = data.streams?.[0] || {};
        const format = data.format || {};

        // Parse frame rate (e.g., "24000/1001" -> 23.976)
        let fps: number | null = null;
        if (stream.r_frame_rate) {
          const [num, den] = stream.r_frame_rate.split('/').map(Number);
          if (den) {
            fps = num / den;
          } else {
            fps = num;
          }
        }

        resolve({
          duration: format.duration ? parseFloat(format.duration) : null,
          width: stream.width || null,
          height: stream.height || null,
          videoCodec: stream.codec_name || null,
          videoFps: fps,
          audioCodec: null, // Would need separate audio stream analysis
          audioChannels: null,
          container: format.format_name?.split(',')[0] || null,
          bitrate: format.bit_rate ? parseInt(format.bit_rate) : null,
        });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err}`));
      }
    });
  });
}

export function getContentType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'webm':
      return 'video/webm';
    default:
      return 'video/mp4';
  }
}