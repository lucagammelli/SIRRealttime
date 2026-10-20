import { LIVE_FRAME_MAX_DECODED_BYTES } from '@arenalive/shared';

/** True when the browser can decompress gzip frames (then the socket URL asks `enc=gzip`). */
export function supportsGzip(): boolean {
  return typeof DecompressionStream === 'function';
}

/** `url` with `enc=gzip` added to its query. */
export function withGzip(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}enc=gzip`;
}

async function bytesOf(data: unknown): Promise<Uint8Array<ArrayBuffer> | null> {
  // Tag check instead of instanceof: an ArrayBuffer of another realm (iframe, test environment) is fine too.
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data as ArrayBuffer);
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy;
  }
  if (typeof Blob === 'function' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return null;
}

/**
 * Text of a binary live frame (gzip of the JSON message); null when it is not gzip, not UTF-8 or, decompressed,
 * longer than `maxBytes` (the decompression stops there: no zip bombs).
 */
export async function gunzipFrame(data: unknown, maxBytes = LIVE_FRAME_MAX_DECODED_BYTES): Promise<string | null> {
  const bytes = await bytesOf(data);
  if (!bytes || !supportsGzip()) return null;
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(out);
  } catch {
    return null;
  }
}
