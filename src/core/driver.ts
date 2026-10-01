import type {
  ChatAdapter,
  Conversation,
  ConversationStore,
  InboundMessage,
  Runner,
} from "./types.js";

export interface DriverOptions {
  store: ConversationStore;
  runner: Runner;
  /** platform 名 → アダプタ。返信の送信先を引くために使う。 */
  adapters: Map<string, ChatAdapter>;
  /** 同じ messageId を二度処理しないための記憶数 */
  dedupeSize?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export const conversationKey = (m: Pick<InboundMessage, "platform" | "channelId" | "threadId">) =>
  `${m.platform}:${m.channelId}:${m.threadId}`;

const RESET_COMMANDS = new Set(["!reset", "/reset", "リセット"]);

/**
 * 駆動の中心。
 *
 * 1. 受信メッセージからスレッド鍵を作る
 * 2. 既知の会話なら「返信による再駆動」、未知でボット宛てなら「新規会話」、それ以外は無視
 * 3. 履歴に user 発言を積み、Runner で回答を生成し、履歴と一緒に保存
 * 4. 同じスレッドへ回答を投稿する（→ その回答への返信がまた 1. に戻る）
 */
export class Driver {
  private readonly store: ConversationStore;
  private readonly runner: Runner;
  private readonly adapters: Map<string, ChatAdapter>;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly dedupeSize: number;
  /** スレッド単位の直列化。同じスレッドで並行実行すると履歴が壊れるため。 */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(opts: DriverOptions) {
    this.store = opts.store;
    this.runner = opts.runner;
    this.adapters = opts.adapters;
    this.dedupeSize = opts.dedupeSize ?? 2000;
    this.log = opts.logger ?? console;
  }

  /** アダプタに渡すハンドラ。 */
  readonly handle = async (msg: InboundMessage): Promise<void> => {
    const dedupeKey = `${msg.platform}:${msg.channelId}:${msg.messageId}`;
    if (this.seen.has(dedupeKey)) return;
    this.remember(dedupeKey);

    const key = conversationKey(msg);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.process(msg, key)).catch((err) => {
      this.log.error(`[driver] ${key}: ${String(err)}`);
    });
    this.queues.set(key, next);
    await next;
    if (this.queues.get(key) === next) this.queues.delete(key);
  };

  private async process(msg: InboundMessage, key: string): Promise<void> {
    const adapter = this.adapters.get(msg.platform);
    if (!adapter) {
      this.log.warn(`[driver] no adapter for platform "${msg.platform}"`);
      return;
    }

    const text = msg.text.trim();
    if (!text) return;

    let conv = await this.store.get(key);

    if (RESET_COMMANDS.has(text)) {
      if (conv) {
        await this.store.delete(key);
        await adapter.send({ channelId: msg.channelId, threadId: msg.threadId, text: "会話履歴をリセットしました。" });
      }
      return;
    }

    if (!conv) {
      if (!msg.addressed) return; // 自分宛てでない・知らないスレッド → 無視
      conv = this.newConversation(msg, key);
      this.log.info(`[driver] new conversation ${key}`);
    } else {
      conv.state ??= {}; // 旧形式の保存データとの互換
      this.log.info(`[driver] reply drives ${key} (turns=${conv.history.length})`);
    }

    conv.history.push({ role: "user", content: text });

    let result;
    try {
      result = await this.runner.run(conv.history, { conversationKey: key, state: conv.state });
    } catch (err) {
      conv.history.pop(); // 失敗した発言は履歴に残さない（再送で再試行できる）
      await this.store.save(conv);
      this.log.error(`[driver] runner failed for ${key}: ${String(err)}`);
      await adapter.send({
        channelId: msg.channelId,
        threadId: msg.threadId,
        text: "⚠️ 回答の生成に失敗しました。もう一度このスレッドに返信してください。",
      });
      return;
    }

    conv.history.push({ role: "assistant", content: result.assistantContent });
    conv.updatedAt = new Date().toISOString();
    await this.store.save(conv);

    await adapter.send({ channelId: msg.channelId, threadId: msg.threadId, text: result.text });
  }

  private newConversation(msg: InboundMessage, key: string): Conversation {
    const now = new Date().toISOString();
    return {
      key,
      platform: msg.platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
      createdAt: now,
      updatedAt: now,
      history: [],
      state: {},
    };
  }

  private remember(id: string) {
    this.seen.add(id);
    this.seenOrder.push(id);
    while (this.seenOrder.length > this.dedupeSize) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
  }
}
