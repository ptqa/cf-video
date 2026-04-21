/**
 * R2 upload client using S3-compatible API with progress tracking.
 * Streams from disk with concurrent part uploads for maximum throughput.
 */

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { type Config } from './config';

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  speed: number; // bytes per second
}

const PART_SIZE = 50 * 1024 * 1024; // 50MB parts
const PART_CONCURRENCY = 3; // upload 3 parts at once per file

/**
 * Read a specific byte range from a file into a Buffer.
 */
function readFileRange(filePath: string, start: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath, { start, end: start + length - 1 });
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export class R2Uploader {
  private client: S3Client;
  private bucketName: string;

  constructor(config: Config) {
    this.bucketName = config.r2.bucket_name;
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.access_key_id,
        secretAccessKey: config.r2.secret_access_key,
      },
    });
  }

  /**
   * Check if an object exists in R2 with a given size.
   */
  async exists(key: string, expectedSize: number): Promise<boolean> {
    try {
      const result = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }));
      return result.ContentLength === expectedSize;
    } catch {
      return false;
    }
  }

  /**
   * Upload a file from disk to R2 with multipart and progress tracking.
   * Streams parts from disk (no full file in memory) and uploads parts concurrently.
   */
  async uploadFileWithProgress(
    key: string,
    filePath: string,
    fileSize: number,
    contentType: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    const total = fileSize;
    const numParts = Math.ceil(total / PART_SIZE);

    // Report initial progress
    if (onProgress) {
      onProgress({ loaded: 0, total, percent: 0, speed: 0 });
    }

    // For files under 100MB, use simple putObject (stream the whole file)
    if (total < 100 * 1024 * 1024) {
      const startTime = Date.now();
      const body = await readFileRange(filePath, 0, total);
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: total,
      }));

      const duration = (Date.now() - startTime) / 1000;
      if (onProgress) {
        onProgress({ loaded: total, total, percent: 100, speed: duration > 0 ? total / duration : 0 });
      }
      return;
    }

    // Create multipart upload
    const createResult = await this.client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: contentType,
    }));

    const uploadId = createResult.UploadId;
    if (!uploadId) {
      throw new Error('Failed to create multipart upload');
    }

    const parts: { ETag: string; PartNumber: number }[] = [];
    let uploadedBytes = 0;
    let lastReportedBytes = 0;
    let lastReportTime = Date.now();

    const reportProgress = () => {
      if (!onProgress) return;
      const now = Date.now();
      const timeDiff = (now - lastReportTime) / 1000;
      let speed = 0;
      if (timeDiff > 0.1) {
        speed = (uploadedBytes - lastReportedBytes) / timeDiff;
        lastReportedBytes = uploadedBytes;
        lastReportTime = now;
      }
      onProgress({
        loaded: uploadedBytes,
        total,
        percent: Math.round((uploadedBytes / total) * 100),
        speed,
      });
    };

    try {
      // Build list of parts to upload
      const partDefs: { partNumber: number; start: number; length: number }[] = [];
      for (let i = 0; i < numParts; i++) {
        const start = i * PART_SIZE;
        const length = Math.min(PART_SIZE, total - start);
        partDefs.push({ partNumber: i + 1, start, length });
      }

      // Upload parts with concurrency limit
      let partIndex = 0;

      const uploadWorker = async (): Promise<void> => {
        while (partIndex < partDefs.length) {
          const idx = partIndex++;
          const partDef = partDefs[idx];

          // Read just this part from disk
          const partBuffer = await readFileRange(filePath, partDef.start, partDef.length);

          const partResult = await this.client.send(new UploadPartCommand({
            Bucket: this.bucketName,
            Key: key,
            UploadId: uploadId,
            PartNumber: partDef.partNumber,
            Body: partBuffer,
            ContentLength: partDef.length,
          }));

          parts.push({
            ETag: partResult.ETag!,
            PartNumber: partDef.partNumber,
          });

          uploadedBytes += partDef.length;
          reportProgress();
        }
      };

      // Run concurrent workers
      const workerCount = Math.min(PART_CONCURRENCY, numParts);
      await Promise.all(
        Array(workerCount).fill(null).map(() => uploadWorker())
      );

      // Sort parts by number (required by S3)
      parts.sort((a, b) => a.PartNumber - b.PartNumber);

      // Complete multipart upload
      await this.client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }));

      if (onProgress) {
        onProgress({ loaded: total, total, percent: 100, speed: 0 });
      }
    } catch (error) {
      // Abort on error
      try {
        await this.client.send(new AbortMultipartUploadCommand({
          Bucket: this.bucketName,
          Key: key,
          UploadId: uploadId,
        }));
      } catch {
        // Ignore abort errors
      }
      throw error;
    }
  }

  /**
   * Upload video file from disk with resume and progress support.
   * Returns true if uploaded, false if skipped (already exists).
   */
  async uploadVideoFile(
    key: string,
    filePath: string,
    contentType: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<boolean> {
    const fileInfo = await stat(filePath);
    const fileSize = fileInfo.size;

    if (await this.exists(key, fileSize)) {
      return false;
    }

    await this.uploadFileWithProgress(key, filePath, fileSize, contentType, onProgress);
    return true;
  }

  /**
   * Upload image (poster/backdrop).
   */
  async uploadImage(key: string, body: Buffer | Uint8Array, mimeType: string = 'image/jpeg'): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: mimeType,
    }));
  }

  /**
   * Delete an object from R2.
   */
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    }));
  }
}
