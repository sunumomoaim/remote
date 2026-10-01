import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** チャンネルと PC 上のプロジェクトフォルダの紐づけ。 */
export interface ProjectBinding {
  /** `${platform}:${channelId}` */
  channelKey: string;
  platform: string;
  channelId: string;
  /** Claude Code を実行する作業ディレクトリ */
  cwd: string;
  createdAt: string;
  updatedAt: string;
  /** Runner の状態（Claude Code のセッション ID など） */
  state: Record<string, string>;
}

export const channelKeyOf = (platform: string, channelId: string) => `${platform}:${channelId}`;

/** 1 ファイルの JSON に全チャンネルの紐づけを保存する。 */
export class ProjectRegistry {
  private map = new Map<string, ProjectBinding>();
  private loaded = false;

  constructor(private readonly file: string) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.file, "utf8");
      const list = JSON.parse(raw) as ProjectBinding[];
      for (const b of list) this.map.set(b.channelKey, { ...b, state: b.state ?? {} });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify([...this.map.values()], null, 2), "utf8");
    await rename(tmp, this.file);
  }

  async get(channelKey: string): Promise<ProjectBinding | undefined> {
    await this.load();
    return this.map.get(channelKey);
  }

  async bind(platform: string, channelId: string, cwd: string): Promise<ProjectBinding> {
    await this.load();
    const channelKey = channelKeyOf(platform, channelId);
    const now = new Date().toISOString();
    const prev = this.map.get(channelKey);
    const binding: ProjectBinding = {
      channelKey,
      platform,
      channelId,
      cwd,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      // フォルダが変わったらセッションも引き継がない
      state: prev && prev.cwd === cwd ? prev.state : {},
    };
    this.map.set(channelKey, binding);
    await this.persist();
    return binding;
  }

  async save(binding: ProjectBinding): Promise<void> {
    await this.load();
    binding.updatedAt = new Date().toISOString();
    this.map.set(binding.channelKey, binding);
    await this.persist();
  }

  async unbind(channelKey: string): Promise<boolean> {
    await this.load();
    const existed = this.map.delete(channelKey);
    if (existed) await this.persist();
    return existed;
  }

  async list(): Promise<ProjectBinding[]> {
    await this.load();
    return [...this.map.values()];
  }
}
