/** HTTP error carrying a status code and optional extra payload. */
export class HttpError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const REPLY = Symbol('reply');

/** Wrap a handler return value with an explicit status code. */
export function reply(status, data) {
  return { [REPLY]: true, status, data };
}

export function isReply(value) {
  return Boolean(value && value[REPLY]);
}
