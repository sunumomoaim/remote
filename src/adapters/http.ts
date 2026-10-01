import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { ChatAdapter, InboundHandler, OutboundMessage } from "../core/types.js";

export interface HttpAdapterOptions {
  port?: number;
  host?: string;
  /** Driver が投稿した返信を外部へ転送する先（任意）。POST で {channelId, threadId, text} を送る。 */
  outboundWebhook?: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * 汎用 HTTP アダプタ。
 *
 * - POST /messages {channelId?, threadId?, userId?, text}
 *     threadId を省略すると新しい会話を開始し、応答に threadId を返す。
 *     同じ threadId で再度 POST すると「返信」として会話が続く。
 * - 応答 JSON: {threadId, reply}
 *
 * Slack 以外のチャット（LINE / Discord / 自作 UI）から橋渡しするとき、
 * あるいは curl で動作確認するときに使う。
 */
export class HttpAdapter implements ChatAdapter {
  readonly name = "http";
  private server: Server | undefined;
  private readonly port: number;
  private readonly host: string;
  private readonly webhook: string | undefined;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  /** threadId → 返信を待っている HTTP レスポンス */
  private readonly waiters = new Map<string, (text: string) => void>();

  constructor(opts: HttpAdapterOptions = {}) {
    this.port = opts.port ?? 3000;
    this.host = opts.host ?? "127.0.0.1";
    this.webhook = opts.outboundWebhook;
    this.log = opts.logger ?? console;
  }

  async start(handler: InboundHandler): Promise<void> {
    this.server = createServer((req, res) => void this.route(req, res, handler));
    await new Promise<void>((resolve) => this.server!.listen(this.port, this.host, resolve));
    this.log.info(`[http] listening on http://${this.host}:${this.port}`);
  }

  async send(msg: OutboundMessage): Promise<{ messageId: string }> {
    const id = randomUUID();
    const waiter = this.waiters.get(msg.threadId);
    if (waiter) {
      this.waiters.delete(msg.threadId);
      waiter(msg.text);
    }
    if (this.webhook) {
      await fetch(this.webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...msg, messageId: id }),
      }).catch((err) => this.log.error(`[http] webhook failed: ${String(err)}`));
    }
    return { messageId: id };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  address(): { port: number; host: string } {
    const a = this.server?.address();
    if (a && typeof a === "object") return { port: a.port, host: a.address };
    return { port: this.port, host: this.host };
  }

  private async route(req: IncomingMessage, res: ServerResponse, handler: InboundHandler) {
    if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/messages") return json(res, 404, { error: "not found" });

    let body: { channelId?: string; threadId?: string; userId?: string; text?: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "invalid json" });
    }
    if (!body.text) return json(res, 400, { error: "text is required" });

    const threadId = body.threadId ?? randomUUID();
    const channelId = body.channelId ?? "default";
    const replyPromise = new Promise<string>((resolve) => this.waiters.set(threadId, resolve));

    await handler({
      platform: this.name,
      channelId,
      threadId,
      messageId: randomUUID(),
      userId: body.userId ?? "anonymous",
      text: body.text,
      addressed: !body.threadId, // threadId 無し = 新規開始、あり = 返信
    });

    // Driver が send() を呼ばなかった（無視された）場合に備えて短い猶予後に解決
    const reply = await Promise.race([
      replyPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
    ]);
    this.waiters.delete(threadId);
    if (reply === null) return json(res, 202, { threadId, reply: null, note: "ignored or not addressed" });
    return json(res, 200, { threadId, reply });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
