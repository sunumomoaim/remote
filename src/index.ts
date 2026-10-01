import { Driver } from "./core/driver.js";
import { FileStore } from "./core/store.js";
import type { ChatAdapter, Runner } from "./core/types.js";
import { HttpAdapter } from "./adapters/http.js";
import { SlackAdapter } from "./adapters/slack.js";
import { ClaudeRunner } from "./runners/claude.js";
import { EchoRunner } from "./runners/echo.js";

const env = process.env;

function buildRunner(): Runner {
  if (env.RUNNER === "echo") {
    console.info("[boot] runner=echo (API を呼ばないダミー)");
    return new EchoRunner();
  }
  console.info(`[boot] runner=claude model=${env.CLAUDE_MODEL ?? "claude-opus-5-5"}`);
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
      list.push(new SlackAdapter({ botToken: env.SLACK_BOT_TOKEN, appToken: env.SLACK_APP_TOKEN }));
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
  const driver = new Driver({
    store: new FileStore(env.DATA_DIR ?? "data/conversations"),
    runner: buildRunner(),
    adapters: new Map(adapters.map((a) => [a.name, a])),
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
