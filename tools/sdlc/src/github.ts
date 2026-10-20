/**
 * A small GitHub client on `fetch`: REST and GraphQL, retrying what is worth retrying (5xx and the
 * secondary rate limit) and nothing else. No dependencies, so the CLI runs without `npm ci`.
 */

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export interface GitHubClient {
  rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

type Fetch = typeof fetch;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createClient(
  token: string,
  options: { apiUrl?: string; fetch?: Fetch; retries?: number } = {},
): GitHubClient {
  const apiUrl = (options.apiUrl ?? process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(
    /\/$/,
    '',
  );
  const doFetch = options.fetch ?? fetch;
  const retries = options.retries ?? 3;

  async function request(method: string, url: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'group-budget-sdlc',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      if (response.ok) return text === '' ? null : JSON.parse(text);

      const secondaryLimit =
        (response.status === 403 || response.status === 429) &&
        (response.headers.get('retry-after') !== null || /secondary rate limit/i.test(text));
      if ((response.status >= 500 || secondaryLimit) && attempt < retries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000,
        );
        continue;
      }
      let message = text;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new GitHubError(
        response.status,
        `${method} ${url.replace(apiUrl, '')}: ${response.status} ${message}`,
      );
    }
  }

  return {
    rest: async <T>(method: string, path: string, body?: unknown) =>
      (await request(method, `${apiUrl}${path}`, body)) as T,
    graphql: async <T>(query: string, variables: Record<string, unknown> = {}) => {
      const result = (await request('POST', `${apiUrl}/graphql`, { query, variables })) as {
        data?: T;
        errors?: { message: string; type?: string }[];
      };
      if (result.errors?.length) {
        throw new GitHubError(200, `GraphQL: ${result.errors.map((e) => e.message).join('; ')}`);
      }
      return result.data as T;
    },
  };
}

/** Follows REST pagination for list endpoints that take `per_page` and `page`. */
export async function paginate<T>(client: GitHubClient, path: string, limit = 500): Promise<T[]> {
  const items: T[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; items.length < limit; page++) {
    const batch = await client.rest<T[]>('GET', `${path}${sep}per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}
