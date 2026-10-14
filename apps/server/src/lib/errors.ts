/** HTTP error with a code; `message` is the only text sent to the client (never stack traces). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message = 'Richiesta non valida'): HttpError => new HttpError(400, 'BAD_REQUEST', message);
export const unauthorized = (): HttpError => new HttpError(401, 'UNAUTHORIZED', 'Non autorizzato');
export const forbidden = (): HttpError => new HttpError(403, 'FORBIDDEN', 'Accesso negato');
export const notFound = (): HttpError => new HttpError(404, 'NOT_FOUND', 'Non trovato');
export const conflict = (message: string): HttpError => new HttpError(409, 'CONFLICT', message);
export const payloadTooLarge = (): HttpError =>
  new HttpError(413, 'FST_ERR_CTP_BODY_TOO_LARGE', 'Richiesta troppo grande');
export const unsupportedMediaType = (): HttpError =>
  new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Formato della richiesta non supportato');
