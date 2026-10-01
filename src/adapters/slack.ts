import bolt from "@slack/bolt";
import type { ChatAdapter, InboundHandler, InboundMessage, OutboundMessage } from "../core/types.js";

const { App } = bolt;

export interface SlackAdapterOptions {
  botToken: string;
  appToken: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/**
 * Slack 用アダプタ（Socket Mode なので公開 URL 不要）。
 *
 * - @bot メンション / DM        → addressed=true  （新規会話を開始できる）
 * - 既存スレッドへの通常の返信  → addressed=false （Driver が既知スレッドなら会話を継続）
 */
export class SlackAdapter implements ChatAdapter {
  readonly name = "slack";
  private readonly app: InstanceType<typeof App>;
  private botUserId: string | undefined;
  private readonly log: Pick<Console, "info" | "warn" | "error">;

  constructor(opts: SlackAdapterOptions) {
    this.log = opts.logger ?? console;
    this.app = new App({ token: opts.botToken, appToken: opts.appToken, socketMode: true });
  }

  async start(handler: InboundHandler): Promise<void> {
    const auth = await this.app.client.auth.test();
    this.botUserId = auth.user_id as string | undefined;

    // メンション（チャンネル内で明示的に呼ばれた）
    this.app.event("app_mention", async ({ event }) => {
      await handler(
        this.toInbound({
          channel: event.channel,
          ts: event.ts,
          thread_ts: event.thread_ts,
          user: event.user,
          text: event.text,
          addressed: true,
        }),
      );
    });

    // 通常のメッセージ: DM、またはスレッド内返信
    this.app.event("message", async ({ event }) => {
      const e = event as {
        subtype?: string;
        bot_id?: string;
        channel: string;
        channel_type?: string;
        ts: string;
        thread_ts?: string;
        user?: string;
        text?: string;
      };
      if (e.subtype || e.bot_id || !e.user || e.user === this.botUserId) return; // 自分や編集/削除イベントは無視
      const isDm = e.channel_type === "im";
      const mentionsBot = !!this.botUserId && (e.text ?? "").includes(`<@${this.botUserId}>`);
      if (mentionsBot) return; // app_mention 側で処理する（二重処理の回避）
      const isThreadReply = !!e.thread_ts && e.thread_ts !== e.ts;
      if (!isDm && !isThreadReply) return; // チャンネルの雑談は拾わない
      await handler(
        this.toInbound({
          channel: e.channel,
          ts: e.ts,
          thread_ts: e.thread_ts,
          user: e.user,
          text: e.text ?? "",
          addressed: isDm,
        }),
      );
    });

    await this.app.start();
    this.log.info(`[slack] connected as ${this.botUserId ?? "?"} (socket mode)`);
  }

  async send(msg: OutboundMessage): Promise<{ messageId: string }> {
    const res = await this.app.client.chat.postMessage({
      channel: msg.channelId,
      thread_ts: msg.threadId,
      text: msg.text,
    });
    return { messageId: (res.ts as string | undefined) ?? "" };
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  private toInbound(e: {
    channel: string;
    ts: string;
    thread_ts?: string;
    user?: string;
    text: string;
    addressed: boolean;
  }): InboundMessage {
    const text = this.botUserId ? e.text.replaceAll(`<@${this.botUserId}>`, "").trim() : e.text.trim();
    return {
      platform: this.name,
      channelId: e.channel,
      threadId: e.thread_ts ?? e.ts, // スレッド外の発言は自身がスレッドの根本になる
      messageId: e.ts,
      userId: e.user ?? "unknown",
      text,
      addressed: e.addressed,
    };
  }
}
