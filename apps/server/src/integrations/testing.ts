import type { FetchLike } from './hosts';
/** Test helpers: a fake `fetch` that records every call and answers from a handler. No network. */

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body (null when there is none or it is multipart). */
  json: unknown;
  form: FormData | null;
  redirect: RequestRedirect | undefined;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const raw = init?.body;
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      json: typeof raw === 'string' ? JSON.parse(raw) : null,
      form: raw instanceof FormData ? raw : null,
      redirect: init?.redirect,
    };
    calls.push(call);
    return handler(call);
  }) as FetchLike;
  return { fetch, calls };
}
