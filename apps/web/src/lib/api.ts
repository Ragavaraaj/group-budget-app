import type { z } from 'zod';

/** The server answered, but not with success. */
export class ApiError extends Error {
  readonly status: number;
  /** The server's machine-readable `error` code, when it sent one (e.g. "invite_invalid"). */
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The request never got an answer: offline, DNS, a dropped connection. */
export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

async function send(
  method: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError();
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      const payload = (await response.json()) as { error?: unknown };
      if (typeof payload.error === 'string') code = payload.error;
    } catch {
      // Not JSON (a proxy error page, say); the status is all we have.
    }
    throw new ApiError(response.status, code, `${method} ${path} failed with ${response.status}`);
  }
  return response;
}

/** GET a same-origin API path and validate the body against a shared zod schema. */
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const response = await send('GET', path, undefined, signal);
  return schema.parse(await response.json());
}

/** Send a JSON body (POST/PATCH/DELETE) and validate the reply. */
export async function apiSend<S extends z.ZodType>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const response = await send(method, path, body, signal);
  return schema.parse(await response.json());
}

/** Like `apiSend` for endpoints whose reply we don't read. */
export async function apiCall(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<void> {
  await send(method, path, body);
}
