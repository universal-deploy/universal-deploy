export interface Store {
  entries: EntryMeta[];
}

export interface EntryMeta {
  /**
   * Module identifier for this entry. This can be a filesystem path or a virtual module.
   */
  id: string;
  /**
   * HTTP method(s) to match. When omitted, matches all HTTP methods.
   */
  method?: HttpMethod | HttpMethod[];
  /**
   * Route pattern(s) for this entry.
   *
   * Should be a valid {@link https://github.com/h3js/rou3 | rou3} pattern.
   */
  route: string | string[];
  /**
   * The Vite environment for this entry.
   *
   * @default ssr
   */
  environment?: string;
}

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "CONNECT" | "OPTIONS" | "TRACE" | "PATCH";

export type EntryTransformer = (entry: EntryMeta, index: number) => EntryMeta;

export interface Fetchable {
  fetch: (request: Request) => Response | Promise<Response>;
}
