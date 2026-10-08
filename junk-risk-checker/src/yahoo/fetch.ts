/** ページ取得。1 つの関数にまとめ、テストでは差し替える。 */
export type Fetcher = (url: string) => Promise<string>;

export interface FetcherOptions {
  /** 連続アクセスの最小間隔（ミリ秒） */
  minIntervalMs?: number;
  userAgent?: string;
  timeoutMs?: number;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/**
 * 間隔を空けて直列に取得する Fetcher を作る。
 * 同時に複数の判定が走っても、ヤフオクへのアクセスは全体で 1 本に絞られる。
 */
export function createFetcher(opts: FetcherOptions = {}): Fetcher {
  const minInterval = opts.minIntervalMs ?? 1000;
  const ua = opts.userAgent ?? DEFAULT_UA;
  const timeoutMs = opts.timeoutMs ?? 15000;
  let chain: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  return (url) => {
    const run = async () => {
      const wait = lastAt + minInterval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      const res = await fetch(url, {
        headers: { "user-agent": ua, "accept-language": "ja,en;q=0.8", accept: "text/html,*/*;q=0.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await res.text();
      if (!res.ok) throw new FetchError(url, res.status, body.slice(0, 500));
      return body;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => undefined);
    return p;
  };
}

export class FetchError extends Error {
  constructor(
    public url: string,
    public status: number,
    public bodyHead: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "FetchError";
  }
}
