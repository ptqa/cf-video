/**
 * R2 upload client using S3-compatible API.
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { type Config } from './config';

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
   * Upload a file buffer to R2.
   */
  async upload(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  /**
   * Upload video file, skipping if already exists with same size.
   * Returns true if uploaded, false if skipped.
   */
  async uploadVideo(key: string, body: Buffer | Uint8Array, contentType: string): Promise<boolean> {
    if (await this.exists(key, body.length)) {
      return false;
    }
    await this.upload(key, body, contentType);
    return true;
  }

  /**
   * Upload image (poster/backdrop).
   */
  async uploadImage(key: string, body: Buffer | Uint8Array, mimeType: string = 'image/jpeg'): Promise<void> {
    await this.upload(key, body, mimeType);
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