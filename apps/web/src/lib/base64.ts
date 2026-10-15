/** Bytes per call of String.fromCharCode (stays well under the argument limit of the engines). */
const CHUNK = 0x8000;

/** Pure: base64 of binary data (the upload of an image travels as base64 inside JSON). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Base64 of the content of a file chosen by the user (FileReader: also where Blob.arrayBuffer is missing). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(bytesToBase64(new Uint8Array(result)));
      else reject(new Error('file not read'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('file not read'));
    reader.readAsArrayBuffer(file);
  });
}
