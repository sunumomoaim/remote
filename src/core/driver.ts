import { stat } from "node:fs/promises";
import path from "node:path";
import { channelKeyOf, type ProjectBinding, type ProjectRegistry } from "./projects.js";
import { listLocalSessions } from "./sessions.js";
import type {
  ChatAdapter,
  Conversation,
  ConversationStore,
  HistoryMessage,
  InboundMessage,
  Progress,
  ReplyTarget,
  RunContext,
  Runner,
  RunResult,
} from "./types.js";

export interface DriverOptions {
  store: ConversationStore;
  runner: Runner;
  /** platform 名 → アダプタ。返信の送信先を引くために使う。 */
  adapters: Map<string, ChatAdapter>;
  /** チャンネルとプロジェクトフォルダの紐づけ（省略するとプロジェクト機能は無効） */
  projects?: ProjectRegistry;
  /** プロジェクト用 Runner を作業ディレクトリごとに作る */
  projectRunner?: (cwd: string) => Runner;
  /** リアルタイム表示の更新間隔（ms） */
  updateIntervalMs?: number;
  /** 同じ messageId を二度処理しないための記憶数 */
  dedupeSize?: number;
  /** PC 上のセッション一覧を読む HOME（テスト用） */
  home?: string;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export const conversationKey = (m: Pick<InboundMessage, "platform" | "channelId" | "threadId">) =>
  `${m.platform}:${m.channelId}:${m.threadId}`;

const RESET_COMMANDS = new Set(["!reset", "/reset", "リセット"]);
const THINKING = "⏳ 考え中…";
const MAX_ACTIVITY_LIVE = 8;
const MAX_ACTIVITY_FINAL = 5;

const HELP = [
  "*使い方*",
  "• メンションか DM で話しかける → スレッドに回答。回答に返信すると会話が続く",
  "• `!project /path/to/dir` → このチャンネルを PC 上のそのフォルダに紐づける（以後、メンション不要で Claude Code が動く）",
  "• `!project` → 紐づけを表示、`!unproject` → 解除",
  "• `!sessions` → そのフォルダの過去セッション一覧、`!resume <id>` → そのセッションの続きから",
  "• `!new` → 新しいセッションで始める、`!stop` → 実行中の処理を中断",
  "• `!reset` → このスレッドの会話をリセット",
].join("\n");

/**
 * 駆動の中心。
 *
 * スレッド会話モード:
 *   1. 受信メッセージからスレッド鍵を作る
 *   2. 既知の会話なら「返信による再駆動」、未知でボット宛てなら「新規会話」、それ以外は無視
 *   3. 履歴に user 発言を積み、Runner で回答を生成し、履歴と一緒に保存
 *   4. 同じスレッドへ回答を投稿する（→ その回答への返信がまた 1. に戻る）
 *
 * プロジェクトモード（`!project` で紐づけたチャンネル）:
 *   チャンネル内の発言はすべて、そのフォルダで動く Claude Code への指示になる。
 *   回答は途中経過をリアルタイムに書き換えながら表示する。
 */
export class Driver {
  private readonly store: ConversationStore;
  private readonly runner: Runner;
  private readonly adapters: Map<string, ChatAdapter>;
  private readonly projects: ProjectRegistry | undefined;
  private readonly projectRunner: ((cwd: string) => Runner) | undefined;
  private readonly projectRunners = new Map<string, Runner>();
  private readonly updateIntervalMs: number;
  private readonly home: string | undefined;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly dedupeSize: number;
  /** スレッド / チャンネル単位の直列化。同じ会話で並行実行すると履歴が壊れるため。 */
  private readonly queues = new Map<string, Promise<void>>();
  /** 実行中の処理（!stop 用） */
  private readonly running = new Map<string, AbortController>();

  constructor(opts: DriverOptions) {
    this.store = opts.store;
    this.runner = opts.runner;
    this.adapters = opts.adapters;
    this.projects = opts.projects;
    this.projectRunner = opts.projectRunner;
    this.updateIntervalMs = opts.updateIntervalMs ?? 1500;
    this.dedupeSize = opts.dedupeSize ?? 2000;
    this.home = opts.home;
    this.log = opts.logger ?? console;
  }

  /** アダプタに渡すハンドラ。 */
  readonly handle = async (msg: InboundMessage): Promise<void> => {
    const dedupeKey = `${msg.platform}:${msg.channelId}:${msg.messageId}`;
    if (this.seen.has(dedupeKey)) return;
    this.remember(dedupeKey);

    const adapter = this.adapters.get(msg.platform);
    if (!adapter) {
      this.log.warn(`[driver] no adapter for platform "${msg.platform}"`);
      return;
    }
    const text = msg.text.trim();
    if (!text) return;

    const channelKey = channelKeyOf(msg.platform, msg.channelId);
    const binding = this.projects ? await this.projects.get(channelKey) : undefined;

    // コマンドは直列化の外で処理する（!stop が実行中の処理を止められるように）
    if (text.startsWith("!") && (await this.handleCommand(msg, text, adapter, binding))) return;

    const key = binding ? channelKey : conversationKey(msg);
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => (binding ? this.processProject(msg, text, adapter, binding) : this.processThread(msg, text, adapter, key)))
      .catch((err) => {
        this.log.error(`[driver] ${key}: ${String(err)}`);
      });
    this.queues.set(key, next);
    await next;
    if (this.queues.get(key) === next) this.queues.delete(key);
  };

  // ---------------------------------------------------------------- commands

  private async handleCommand(
    msg: InboundMessage,
    text: string,
    adapter: ChatAdapter,
    binding: ProjectBinding | undefined,
  ): Promise<boolean> {
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    const reply = (body: string) => adapter.send({ ...this.targetOf(msg, text, !!binding), text: body });

    if (RESET_COMMANDS.has(cmd)) {
      const key = conversationKey(msg);
      if (await this.store.get(key)) {
        await this.store.delete(key);
        await reply("会話履歴をリセットしました。");
      }
      return true;
    }

    switch (cmd) {
      case "!help":
        await reply(HELP);
        return true;

      case "!project": {
        if (!this.projects || !this.projectRunner) {
          await reply("プロジェクト機能は無効です（PC 上で claude-code 方式で起動してください）。");
          return true;
        }
        if (!arg) {
          await reply(binding ? `このチャンネルは \`${binding.cwd}\` に紐づいています。` : "このチャンネルはプロジェクトに紐づいていません。`!project /path/to/dir` で紐づけます。");
          return true;
        }
        const cwd = path.resolve(arg.replace(/^~(?=\/|$)/, this.home ?? process.env.HOME ?? "~"));
        try {
          const s = await stat(cwd);
          if (!s.isDirectory()) throw new Error("not a directory");
        } catch {
          await reply(`フォルダが見つかりません: \`${cwd}\``);
          return true;
        }
        await this.projects.bind(msg.platform, msg.channelId, cwd);
        this.log.info(`[driver] bound ${channelKeyOf(msg.platform, msg.channelId)} -> ${cwd}`);
        await reply(`このチャンネルを \`${cwd}\` に紐づけました。ここに書いたことはそのフォルダで Claude Code が実行します。\n\`!sessions\` で過去のセッション、\`!resume <id>\` で続きから、\`!new\` で新規セッションです。`);
        return true;
      }

      case "!unproject": {
        if (this.projects && (await this.projects.unbind(channelKeyOf(msg.platform, msg.channelId)))) {
          await reply("プロジェクトの紐づけを解除しました。");
        } else {
          await reply("このチャンネルはプロジェクトに紐づいていません。");
        }
        return true;
      }

      case "!sessions": {
        if (!binding) {
          await reply("先に `!project /path/to/dir` でフォルダを紐づけてください。");
          return true;
        }
        const sessions = await listLocalSessions(binding.cwd, 10, this.home);
        if (!sessions.length) {
          await reply(`\`${binding.cwd}\` にはまだ Claude Code のセッションがありません。`);
          return true;
        }
        const current = binding.state.claudeCodeSessionId;
        const lines = sessions.map((s) => `${s.id === current ? "▶" : "•"} \`${s.id}\`  ${s.updatedAt.toISOString().slice(0, 16).replace("T", " ")}  ${s.title}`);
        await reply(`*${binding.cwd} のセッション*（新しい順）\n${lines.join("\n")}\n\`!resume <id>\` で続きから話せます。`);
        return true;
      }

      case "!resume": {
        if (!binding || !this.projects) {
          await reply("先に `!project /path/to/dir` でフォルダを紐づけてください。");
          return true;
        }
        if (!/^[0-9a-f-]{36}$/i.test(arg)) {
          await reply("セッション ID を指定してください（`!sessions` で確認できます）。");
          return true;
        }
        binding.state.claudeCodeSessionId = arg;
        await this.projects.save(binding);
        await reply(`セッション \`${arg}\` の続きから話します。`);
        return true;
      }

      case "!new": {
        if (binding && this.projects) {
          delete binding.state.claudeCodeSessionId;
          await this.projects.save(binding);
          await reply("新しいセッションで始めます。");
        } else {
          const key = conversationKey(msg);
          await this.store.delete(key);
          await reply("新しい会話で始めます。");
        }
        return true;
      }

      case "!stop": {
        const key = binding ? binding.channelKey : conversationKey(msg);
        const ctrl = this.running.get(key);
        if (ctrl) {
          ctrl.abort();
          await reply("中断しました。");
        } else {
          await reply("実行中の処理はありません。");
        }
        return true;
      }

      default:
        return false;
    }
  }

  // ------------------------------------------------------------ thread mode

  private async processThread(msg: InboundMessage, text: string, adapter: ChatAdapter, key: string): Promise<void> {
    let conv = await this.store.get(key);
    if (!conv) {
      if (!msg.addressed) return; // 自分宛てでない・知らないスレッド → 無視
      conv = this.newConversation(msg, key);
      this.log.info(`[driver] new conversation ${key}`);
    } else {
      conv.state ??= {}; // 旧形式の保存データとの互換
      this.log.info(`[driver] reply drives ${key} (turns=${conv.history.length})`);
    }

    conv.history.push({ role: "user", content: text });

    const result = await this.runWithLiveReply(adapter, msg, text, false, this.runner, conv.history, {
      conversationKey: key,
      state: conv.state,
    });
    if (!result) {
      conv.history.pop(); // 失敗した発言は履歴に残さない（再送で再試行できる）
      await this.store.save(conv);
      return;
    }

    conv.history.push({ role: "assistant", content: result.assistantContent });
    conv.updatedAt = new Date().toISOString();
    await this.store.save(conv);
  }

  // ----------------------------------------------------------- project mode

  private async processProject(msg: InboundMessage, text: string, adapter: ChatAdapter, binding: ProjectBinding): Promise<void> {
    if (!this.projectRunner || !this.projects) return;
    let runner = this.projectRunners.get(binding.cwd);
    if (!runner) {
      runner = this.projectRunner(binding.cwd);
      this.projectRunners.set(binding.cwd, runner);
    }
    this.log.info(`[driver] project ${binding.channelKey} (${binding.cwd}) session=${binding.state.claudeCodeSessionId ?? "new"}`);

    const result = await this.runWithLiveReply(adapter, msg, text, true, runner, [{ role: "user", content: text }], {
      conversationKey: binding.channelKey,
      state: binding.state,
    });
    // セッション ID などが更新されるので失敗時も保存する
    await this.projects.save(binding);
    if (result) this.log.info(`[driver] project ${binding.channelKey} done session=${binding.state.claudeCodeSessionId}`);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * 「考え中…」を先に投稿し、途中経過で書き換え、最後に回答で置き換える。
   * アダプタが update に対応していなければ最後に 1 回だけ投稿する。
   * 失敗したときはその旨を投稿して undefined を返す。
   */
  private async runWithLiveReply(
    adapter: ChatAdapter,
    msg: InboundMessage,
    text: string,
    project: boolean,
    runner: Runner,
    history: HistoryMessage[],
    ctx: Omit<RunContext, "onProgress" | "signal">,
  ): Promise<RunResult | undefined> {
    const target = this.targetOf(msg, text, project);
    const live = typeof adapter.update === "function";
    const ctrl = new AbortController();
    this.running.set(ctx.conversationKey, ctrl);

    let placeholderId: string | undefined;
    let latest: Progress | undefined;
    let timer: NodeJS.Timeout | undefined;
    let lastRendered = "";
    let updating = Promise.resolve();

    const render = () => {
      timer = undefined;
      if (!placeholderId || !latest) return;
      const body = this.formatLive(latest);
      if (body === lastRendered) return;
      lastRendered = body;
      const id = placeholderId;
      updating = updating.then(() => adapter.update!(msg.channelId, id, body, target.inReplyTo)).catch((err) => {
        this.log.warn(`[driver] live update failed: ${String(err)}`);
      });
    };
    const onProgress = (p: Progress) => {
      latest = p;
      if (!timer) timer = setTimeout(render, this.updateIntervalMs);
    };

    try {
      if (live) {
        const sent = await adapter.send({ ...target, text: THINKING });
        placeholderId = sent.messageId;
      }
      const result = await runner.run(history, { ...ctx, signal: ctrl.signal, onProgress: live ? onProgress : undefined });
      if (timer) clearTimeout(timer);
      timer = undefined;
      await updating;
      const body = this.formatFinal(result);
      if (placeholderId) await adapter.update!(msg.channelId, placeholderId, body, target.inReplyTo);
      else await adapter.send({ ...target, text: body });
      return result;
    } catch (err) {
      if (timer) clearTimeout(timer);
      await updating;
      const aborted = ctrl.signal.aborted;
      if (!aborted) this.log.error(`[driver] runner failed for ${ctx.conversationKey}: ${String(err)}`);
      const body = aborted
        ? "⏹ 中断しました。"
        : "⚠️ 回答の生成に失敗しました。もう一度このスレッドに返信してください。";
      if (placeholderId) await adapter.update!(msg.channelId, placeholderId, body, target.inReplyTo);
      else await adapter.send({ ...target, text: body });
      return undefined;
    } finally {
      if (this.running.get(ctx.conversationKey) === ctrl) this.running.delete(ctx.conversationKey);
    }
  }

  private formatLive(p: Progress): string {
    const lines = p.activity.slice(-MAX_ACTIVITY_LIVE);
    const parts: string[] = [];
    if (lines.length) parts.push(lines.join("\n"));
    parts.push(p.text.trim() ? `⏳ ${p.text.trim()}` : THINKING);
    return parts.join("\n\n");
  }

  private formatFinal(r: RunResult): string {
    const activity = r.activity ?? [];
    if (!activity.length) return r.text;
    const tail = activity.slice(-MAX_ACTIVITY_FINAL).map((l) => `> ${l}`);
    const omitted = activity.length - tail.length;
    const log = `${omitted > 0 ? `> …（他 ${omitted} 件）\n` : ""}${tail.join("\n")}`;
    return `${r.text}\n\n_作業ログ（${activity.length} 件）_\n${log}`;
  }

  /** 返信先。スレッド会話はスレッドへ。プロジェクトチャンネル直下の発言にはチャンネル直下で返す。 */
  private targetOf(msg: InboundMessage, text: string, project: boolean): { channelId: string; threadId?: string; inReplyTo: ReplyTarget } {
    return {
      channelId: msg.channelId,
      threadId: msg.inThread || !project ? msg.threadId : undefined,
      inReplyTo: { userId: msg.userId, messageId: msg.messageId, text },
    };
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
