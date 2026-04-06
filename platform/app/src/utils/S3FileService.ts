import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || process.env.S3_ENDPOINT_URL || 'https://s3.regru.cloud';
const region = 'ru-1'; 
const bucket = process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || 'patient-hot-msk2';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;

console.log('S3 Service Direct Init:', { endpoint, bucket, accessKeySet: !!accessKeyId });

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
      forcePathStyle: true,
      apiVersion: 'latest',
    });
  }

  /**
   * Helper to wrap S3 calls with retry logic for transient errors like ERR_CONNECTION_RESET
   */
  private async withRetries<T>(operation: () => Promise<T>, maxRetries = 3, delay = 500): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        const isNetworkError = 
          err.name === 'FetchError' || 
          err.name === 'TypeError' || 
          err.message?.includes('Failed to fetch') ||
          err.message?.includes('NetworkError');
        
        if (isNetworkError && attempt < maxRetries - 1) {
          const waitTime = delay * Math.pow(2, attempt);
          console.warn(`S3 connection issue (attempt ${attempt + 1}/${maxRetries}). Retrying in ${waitTime}ms...`, err.message);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async listPrefixes(prefix = ''): Promise<{ folders: string[]; files: string[] }> {
    console.log(`Listing S3 prefixes for: "${prefix}" at bucket "${bucket}"`);
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    });

    try {
      const response = await this.withRetries(() => this.client.send(command));
      console.log('S3 List Response:', response);
      const folders = response.CommonPrefixes?.map(cp => cp.Prefix).filter(Boolean) || [];
      const files = response.Contents?.filter(c => c.Key !== prefix).map(c => c.Key).filter(Boolean) || [];
      return { folders, files };
    } catch (error: any) {
      console.error('Detailed S3 listing error after retries:', error);
      return { folders: [], files: [] };
    }
  }

  async getObjectAsBlob(key: string): Promise<Blob> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    try {
      const response = await this.withRetries(() => this.client.send(command));
      const body = response.Body;
      if (typeof body === 'undefined') {
        throw new Error('Response body is undefined');
      }
      return await new Response(body as any).blob();
    } catch (error) {
      console.error(`Detailed S3 fetch error for key "${key}":`, error);
      throw error;
    }
  }

  async getObjectRange(key: string, range: string): Promise<Blob> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: range,
    });

    try {
      const response = await this.withRetries(() => this.client.send(command));
      const body = response.Body;
      if (typeof body === 'undefined') {
        throw new Error('Response body is undefined');
      }
      return await new Response(body as any).blob();
    } catch (error) {
      console.error(`Detailed S3 range fetch error for key "${key}" (${range}):`, error);
      throw error;
    }
  }

  async getMetadataChunk(key: string): Promise<Blob> {
    return await this.getObjectAsBlob(key);
  }

  async listAllObjects(prefix: string): Promise<string[]> {
    let continuationToken: string | undefined;
    const allKeys: string[] = [];

    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await this.withRetries(() => this.client.send(command));
      const keys = response.Contents?.map(c => c.Key).filter(Boolean) || [];
      allKeys.push(...keys);
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return allKeys;
  }

  async getMetadataIndex(prefix: string): Promise<any[] | null> {
    const indexKey = prefix.endsWith('/') ? `${prefix}ohif_metadata.json` : `${prefix}/ohif_metadata.json`;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: indexKey,
    });

    try {
      const response = await this.withRetries(() => this.client.send(command));
      const body = response.Body;
      if (typeof body === 'undefined') return null;
      const text = await new Response(body as any).text();
      return JSON.parse(text);
    } catch (error) {
      console.log('No metadata index found or error fetching it at', indexKey, '. Falling back to slow path.');
      return null;
    }
  }
}

export const s3FileService = new S3FileService();
export default s3FileService;

