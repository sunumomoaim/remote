import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export interface LocalSession {
  id: string;
  title: string;
  updatedAt: Date;
}

/** Claude Code が cwd ごとにセッションを保存するディレクトリ名（`/` → `-`）。 */
export function projectDirName(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** 先頭 64KB から最初のユーザー発言を取り出してタイトルにする。 */
async function readTitle(file: string): Promise<string> {
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, bytesRead).toString("utf8").split("\n")) {
      if (!line.includes('"type":"user"')) continue;
      try {
        const j = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
        if (j.type !== "user") continue;
        const c = j.message?.content;
        const text =
          typeof c === "string"
            ? c
            : Array.isArray(c)
              ? (c as Array<{ type?: string; text?: string }>).filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ")
              : "";
        const t = text.replace(/\s+/g, " ").trim();
        if (t) return t.length > 60 ? `${t.slice(0, 60)}…` : t;
      } catch {
        // 途中で切れた行は無視
      }
    }
  } finally {
    await fh.close();
  }
  return "(無題)";
}

/** PC 上にある、そのフォルダの Claude Code セッションを新しい順に返す。 */
export async function listLocalSessions(cwd: string, limit = 10, home = homedir()): Promise<LocalSession[]> {
  const dir = path.join(home, ".claude", "projects", projectDirName(cwd));
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files = names.filter((n) => n.endsWith(".jsonl"));
  const withTime = await Promise.all(
    files.map(async (n) => ({ file: path.join(dir, n), id: n.slice(0, -".jsonl".length), mtime: (await stat(path.join(dir, n))).mtime })),
  );
  withTime.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const top = withTime.slice(0, limit);
  return Promise.all(top.map(async (s) => ({ id: s.id, title: await readTitle(s.file), updatedAt: s.mtime })));
}
