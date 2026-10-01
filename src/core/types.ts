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
  /** スレッドの中の発言か（false ならチャンネル直下の発言） */
  inThread: boolean;
}

export interface ReplyTarget {
  userId: string;
  messageId: string;
  text: string;
}

export interface OutboundMessage {
  channelId: string;
  /** 省略するとスレッドではなくチャンネル直下に投稿する */
  threadId?: string;
  text: string;
  /** どの発言への返信かを示す情報。アダプタが引用やメンションに使う。 */
  inReplyTo?: ReplyTarget;
}

export type InboundHandler = (msg: InboundMessage) => Promise<void>;

/** チャットプラットフォームとの接続（受信と送信）を担う。 */
export interface ChatAdapter {
  readonly name: string;
  start(handler: InboundHandler): Promise<void>;
  send(msg: OutboundMessage): Promise<{ messageId: string }>;
  /** 投稿済みメッセージを書き換える（リアルタイム表示用。未対応なら省略可） */
  update?(channelId: string, messageId: string, text: string, inReplyTo?: ReplyTarget): Promise<void>;
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
  /** Runner が会話ごとに保持したい小さな状態（例: Claude Code のセッション ID） */
  state: Record<string, string>;
}

export interface ConversationStore {
  get(key: string): Promise<Conversation | undefined>;
  save(conv: Conversation): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 回答生成の途中経過。 */
export interface Progress {
  /** ここまでに生成された本文 */
  text: string;
  /** ツール実行などの作業ログ（1 行ずつ） */
  activity: string[];
}

export interface RunContext {
  conversationKey: string;
  /** 会話ごとの可変状態。Runner が書き換えると Driver が永続化する。 */
  state: Record<string, string>;
  /** 途中経過を受け取るコールバック（指定するとストリーミングで実行される） */
  onProgress?: (progress: Progress) => void;
  /** 中断用 */
  signal?: AbortSignal;
}

export interface RunResult {
  /** チャットへ投稿する本文 */
  text: string;
  /** 履歴に積む assistant の content（thinking block などを含めてそのまま） */
  assistantContent: Anthropic.Beta.BetaContentBlockParam[];
  /** 作業ログ（あれば） */
  activity?: string[];
}

/** 履歴を受け取り AI の返答を生成する。差し替え可能。 */
export interface Runner {
  run(history: HistoryMessage[], ctx: RunContext): Promise<RunResult>;
}
