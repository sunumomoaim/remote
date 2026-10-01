import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Conversation, ConversationStore } from "./types.js";

/** テスト・使い捨て用。 */
export class MemoryStore implements ConversationStore {
  private readonly map = new Map<string, Conversation>();
  async get(key: string) {
    const c = this.map.get(key);
    return c ? structuredClone(c) : undefined;
  }
  async save(conv: Conversation) {
    this.map.set(conv.key, structuredClone(conv));
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

/** 1 会話 = 1 JSON ファイル。プロセスを再起動しても返信で会話を続けられる。 */
export class FileStore implements ConversationStore {
  constructor(private readonly dir: string) {}

  private file(key: string) {
    const hash = createHash("sha1").update(key).digest("hex");
    return path.join(this.dir, `${hash}.json`);
  }

  async get(key: string) {
    try {
      const raw = await readFile(this.file(key), "utf8");
      return JSON.parse(raw) as Conversation;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async save(conv: Conversation) {
    await mkdir(this.dir, { recursive: true });
    const target = this.file(conv.key);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, JSON.stringify(conv, null, 2), "utf8");
    const { rename } = await import("node:fs/promises");
    await rename(tmp, target);
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
