import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const endpoint = process.env.S3_ENDPOINT || process.env.S3_ENDPOINT_URL || 'https://s3.regru.cloud';
const region = 'ru-central1'; 
const bucket = process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || 'patient-hot-msk2';
const accessKeyId = process.env.S3_ACCESS_KEY;
const secretAccessKey = process.env.S3_SECRET_KEY;

console.log('S3 Config Initialization:', { endpoint, bucket, accessKeySet: !!accessKeyId });

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
      return new Response(body as any).blob();
    } catch (error) {
      console.error(`Detailed S3 fetch error for key "${key}":`, error);
      throw error;
    }
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
}

export const s3FileService = new S3FileService();
export default s3FileService;
