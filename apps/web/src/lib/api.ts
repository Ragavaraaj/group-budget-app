import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** GET a same-origin API path and validate the body against a shared zod schema. */
export async function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const res = await fetch(path, {
    signal,
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new ApiError(res.status, `GET ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}
