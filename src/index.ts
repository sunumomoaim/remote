import path from "node:path";
import { Driver } from "./core/driver.js";
import { ProjectRegistry } from "./core/projects.js";
import { FileStore } from "./core/store.js";
import type { ChatAdapter, Runner } from "./core/types.js";
import { HttpAdapter } from "./adapters/http.js";
import { SlackAdapter } from "./adapters/slack.js";
import { ClaudeRunner } from "./runners/claude.js";
import { ClaudeCodeRunner } from "./runners/claude-code.js";
import { EchoRunner } from "./runners/echo.js";

const env = process.env;

const PROJECT_SYSTEM = [
  "あなたはチャットツール（Slack など）から操作されている Claude Code です。",
  "ユーザーの発言はチャットから届き、あなたの回答はチャットに表示されます。",
  "作業の節目で短い進捗を書き、最後に結果を簡潔にまとめてください。",
  "Markdown の見出し(#)は使わず、強調は *太字* 程度にとどめてください。",
].join("\n");

function buildRunner(): Runner {
  // 既定: API キーがあれば API、なければ Claude Code CLI（契約の利用枠で動き、従量課金なし）
  const runner = env.RUNNER ?? (env.ANTHROPIC_API_KEY ? "api" : "claude-code");
  if (runner === "echo") {
    console.info("[boot] runner=echo (API を呼ばないダミー)");
    return new EchoRunner();
  }
  if (runner === "claude-code") {
    console.info(`[boot] runner=claude-code (ローカルの claude コマンド${env.CLAUDE_MODEL ? ` model=${env.CLAUDE_MODEL}` : ""})`);
    return new ClaudeCodeRunner({
      command: env.CLAUDE_COMMAND,
      model: env.CLAUDE_MODEL,
      systemPrompt: env.SYSTEM_PROMPT,
    });
  }
  if (runner !== "api") throw new Error(`unknown RUNNER: ${runner}`);
  console.info(`[boot] runner=api model=${env.CLAUDE_MODEL ?? "claude-opus-5-5"}`);
  return new ClaudeRunner({
    model: env.CLAUDE_MODEL,
    effort: env.CLAUDE_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined,
    systemPrompt: env.SYSTEM_PROMPT,
  });
}

function buildAdapters(): ChatAdapter[] {
  const list: ChatAdapter[] = [];
  const wanted = (env.ADAPTERS ?? (env.SLACK_BOT_TOKEN ? "slack" : "http")).split(",").map((s) => s.trim());

  for (const name of wanted) {
    if (name === "slack") {
      if (!env.SLACK_BOT_TOKEN || !env.SLACK_APP_TOKEN) {
        throw new Error("SLACK_BOT_TOKEN と SLACK_APP_TOKEN が必要です");
      }
      list.push(
        new SlackAdapter({
          botToken: env.SLACK_BOT_TOKEN,
          appToken: env.SLACK_APP_TOKEN,
          quoteOriginal: env.SLACK_QUOTE_ORIGINAL !== "false",
          broadcastToChannel: env.SLACK_REPLY_BROADCAST === "true",
        }),
      );
    } else if (name === "http") {
      list.push(
        new HttpAdapter({
          port: env.PORT ? Number(env.PORT) : 3000,
          host: env.HOST,
          outboundWebhook: env.OUTBOUND_WEBHOOK,
        }),
      );
    } else {
      throw new Error(`unknown adapter: ${name}`);
    }
  }
  return list;
}

async function main() {
  const adapters = buildAdapters();
  const dataDir = env.DATA_DIR ?? "data/conversations";
  const runner = buildRunner();
  // プロジェクト機能（チャンネル = PC 上のフォルダ）は claude-code 方式のときだけ
  const projectsEnabled = runner instanceof ClaudeCodeRunner;
  if (projectsEnabled) {
    console.info(
      `[boot] projects=on permission=${env.PROJECT_PERMISSION_MODE ?? "acceptEdits"}${env.PROJECT_ALLOWED_TOOLS ? ` allowed="${env.PROJECT_ALLOWED_TOOLS}"` : ""}`,
    );
  }
  const driver = new Driver({
    store: new FileStore(dataDir),
    runner,
    adapters: new Map(adapters.map((a) => [a.name, a])),
    projects: projectsEnabled ? new ProjectRegistry(env.PROJECTS_FILE ?? path.join(path.dirname(dataDir), "projects.json")) : undefined,
    projectRunner: projectsEnabled
      ? (cwd) =>
          new ClaudeCodeRunner({
            command: env.CLAUDE_COMMAND,
            model: env.CLAUDE_MODEL,
            systemPrompt: env.PROJECT_SYSTEM_PROMPT ?? PROJECT_SYSTEM,
            cwd,
            tools: env.PROJECT_TOOLS ?? "default",
            permissionMode: env.PROJECT_PERMISSION_MODE ?? "acceptEdits",
            allowedTools: env.PROJECT_ALLOWED_TOOLS,
          })
      : undefined,
    updateIntervalMs: env.STREAM_UPDATE_MS ? Number(env.STREAM_UPDATE_MS) : undefined,
  });

  for (const a of adapters) await a.start(driver.handle);
  console.info(`[boot] ready: adapters=${adapters.map((a) => a.name).join(",")}`);

  const shutdown = async () => {
    console.info("[boot] shutting down");
    await Promise.allSettled(adapters.map((a) => a.stop()));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
