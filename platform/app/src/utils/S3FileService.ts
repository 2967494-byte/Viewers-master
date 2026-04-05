import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || 'https://s3.regru.cloud';
const region = 'ru-central1'; // Default for many Russian S3 providers, or just 'us-east-1'
const bucket = process.env.S3_BUCKET || 'patient-hot-msk2';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;

class S3FileService {
  private client: S3Client;

  constructor() {
    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKeyId || '',
        secretAccessKey: secretAccessKey || '',
      },
      forcePathStyle: true, // Crucial for many S3-compatible providers like Regru
    });
  }

  /**
   * Lists "folders" (prefixes) and files at a given prefix.
   */
  async listPrefixes(prefix = ''): Promise<{ folders: string[]; files: string[] }> {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    });

    try {
      const response = await this.client.send(command);
      const folders = response.CommonPrefixes?.map(cp => cp.Prefix) || [];
      const files = response.Contents?.filter(c => c.Key !== prefix).map(c => c.Key) || [];
      return { folders, files };
    } catch (error) {
      console.error('Error listing S3 objects:', error);
      throw error;
    }
  }

  /**
   * Fetches an object as a Blob.
   */
  async getObjectAsBlob(key: string): Promise<Blob> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      const response = await this.client.send(command);
      const body = response.Body;
      if (typeof body === 'undefined') {
        throw new Error('Response body is undefined');
      }
      // In browser, Body can be a Blob, ReadableStream, etc.
      // A robust way is to use Response wrapper if available
      return new Response(body as any).blob();
    } catch (error) {
      console.error(`Error fetching S3 object ${key}:`, error);
      throw error;
    }
  }

  /**
   * Lists all objects recursively under a prefix.
   */
  async listAllObjects(prefix: string): Promise<string[]> {
    let continuationToken: string | undefined;
    const allKeys: string[] = [];

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.client.send(command);
      const keys = response.Contents?.map(c => c.Key) || [];
      allKeys.push(...keys);
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return allKeys;
  }
}

export const s3FileService = new S3FileService();
export default s3FileService;
