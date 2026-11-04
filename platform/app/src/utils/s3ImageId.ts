export const ORBITAL_S3_SCHEME = 'orbitals3';

export function orbitalS3ImageId(key: string): string {
  return `${ORBITAL_S3_SCHEME}:${encodeURIComponent(key)}`;
}

export function parseS3ImageId(imageId: string): { key: string; frame?: string } {
  const raw = imageId.slice(ORBITAL_S3_SCHEME.length + 1);
  const match = raw.match(/&frame=(\d+)$/);
  return { key: decodeURIComponent(match ? raw.slice(0, match.index) : raw), frame: match?.[1] };
}
