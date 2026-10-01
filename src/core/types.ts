import type Anthropic from "@anthropic-ai/sdk";

/** チャット側から届いた1通のメッセージ（プラットフォーム非依存の正規化形式）。 */
export interface InboundMessage {
  /** "slack" | "http" など、アダプタの名前 */
  platform: string;
  /** チャンネル / DM の ID */
  channelId: string;
  /**
   * スレッドの根本メッセージ ID。
   * Slack なら thread_ts（スレッド外の発言なら自分の ts）。
   * この値が「会話の鍵」になり、同じスレッドへの返信は同じ会話として扱われる。
   */
  threadId: string;
  /** このメッセージ自身の ID（重複配送の排除に使う） */
  messageId: string;
  userId: string;
  text: string;
  /**
   * ボット宛てに明示的に話しかけられたか（メンション / DM）。
   * true なら新しい会話を開始できる。false でも既知のスレッドへの返信なら会話を継続する。
   */
  addressed: boolean;
}

export interface OutboundMessage {
  channelId: string;
  threadId: string;
  text: string;
}

export type InboundHandler = (msg: InboundMessage) => Promise<void>;

/** チャットプラットフォームとの接続（受信と送信）を担う。 */
export interface ChatAdapter {
  readonly name: string;
  start(handler: InboundHandler): Promise<void>;
  send(msg: OutboundMessage): Promise<{ messageId: string }>;
  stop(): Promise<void>;
}

export type HistoryMessage = Anthropic.Beta.BetaMessageParam;

export interface Conversation {
  key: string;
  platform: string;
  channelId: string;
  threadId: string;
  createdAt: string;
  updatedAt: string;
  /** そのまま Messages API に渡せる履歴（assistant 側は content block をそのまま保持する） */
  history: HistoryMessage[];
}

export interface ConversationStore {
  get(key: string): Promise<Conversation | undefined>;
  save(conv: Conversation): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RunResult {
  /** チャットへ投稿する本文 */
  text: string;
  /** 履歴に積む assistant の content（thinking block などを含めてそのまま） */
  assistantContent: Anthropic.Beta.BetaContentBlockParam[];
}

/** 履歴を受け取り AI の返答を生成する。差し替え可能。 */
export interface Runner {
  run(history: HistoryMessage[], ctx: { conversationKey: string }): Promise<RunResult>;
}
