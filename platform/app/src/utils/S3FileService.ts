import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || process.env.S3_ENDPOINT_URL || 'http://s3.regru.cloud';
const region = 'us-east-1'; 
const bucket = process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || 'patient-hot-msk2';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;

console.log('S3 Service Init:', { endpoint, bucket, accessKeySet: !!accessKeyId });

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
      tls: false,
      apiVersion: 'latest',
    });
  }

  async listPrefixes(prefix = ''): Promise<{ folders: string[]; files: string[] }> {
    console.log(`Listing S3 prefixes for: "${prefix}" at bucket "${bucket}"`);
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
    });

    try {
      const response = await this.client.send(command);
      console.log('S3 List Response:', response);
      const folders = response.CommonPrefixes?.map(cp => cp.Prefix) || [];
      const files = response.Contents?.filter(c => c.Key !== prefix).map(c => c.Key) || [];
      return { folders, files };
    } catch (error) {
      console.error('Detailed S3 listing error:', error);
      if (error instanceof Error) {
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
      }
      throw error;
    }
  }

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
      Range: range, // e.g., 'bytes=0-131071'
    });

    try {
      const response = await this.client.send(command);
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
    // Отключаем использование Range-запросов, так как данный S3 веб-сервер возвращает 403 Forbidden.
    // Используем полную загрузку файла для индексации. 
    // Это надежнее и убирает ошибки из консоли.
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

      const response = await this.client.send(command);
      const keys = response.Contents?.map(c => c.Key) || [];
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
      const response = await this.client.send(command);
      const body = response.Body;
      if (typeof body === 'undefined') return null;
      const text = await new Response(body as any).text();
      return JSON.parse(text);
    } catch (error) {
      // Это нормально, если файла нет
      console.log('No pre-generated metadata index found at', indexKey);
      return null;
    }
  }
}

export const s3FileService = new S3FileService();
export default s3FileService;
