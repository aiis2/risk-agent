import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function checksumBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function shortHash(input: string): string {
  return sha256(input).slice(0, 16);
}
