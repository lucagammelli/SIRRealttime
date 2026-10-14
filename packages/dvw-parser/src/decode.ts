import iconv from 'iconv-lite';

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });
const lenientUtf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Decodifica i byte di un DVW senza mai lanciare: con BOM UTF-8 si decodifica in UTF-8 tollerante
 * (byte non validi o troncati, es. file ancora in scrittura, diventano U+FFFD); senza BOM, UTF-8 se valido,
 * altrimenti Windows-1252.
 */
export function decodeDvw(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return lenientUtf8.decode(bytes.subarray(3));
  }
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return iconv.decode(bytes, 'win1252');
  }
}
