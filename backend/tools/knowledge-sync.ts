import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 知识快照同步（`pnpm knowledge:sync [-- --revision <sha>] [--repo <url>]`）。
 *
 * 从上游 ZAFU-PCHospital-Doc 的**固定提交**拉取实际 Markdown 到
 * `data/knowledge/snapshot/`，并生成来源清单 `data/knowledge/knowledge.sources.json`。
 * 快照提交进仓库，组员克隆后无需联网即可建索引；更新时显式选择新提交并记录。
 *
 * 规则（对应 Issue #39 任务书 §4）：
 * - 只收录 SUMMARY.md 中「实际存在且有正文」的 Markdown；空链接、纯目录、占位内容跳过并记录原因；
 * - 不复制嵌套 `.git`、theme、book.toml；
 * - `internal` 段（明确标记的内部测试资料）由同步保留，绝不清除；
 * - 全程失败不破坏已有快照：先写 staging，最后原子替换。
 */

const DEFAULT_REPO = "https://github.com/ZAFU-PCHospital/ZAFU-PCHospital-Doc.git";
const DATA_DIR = path.resolve("data", "knowledge");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshot");
const MANIFEST_PATH = path.join(DATA_DIR, "knowledge.sources.json");
const SUMMARY_FILE = "SUMMARY.md";
/** 去掉标题/URL/标记后的可见正文字符下限；低于视为占位或纯目录章节。 */
const MIN_BODY_CHARS = 40;

type SnapshotFileEntry = {
  path: string;
  title: string;
  summaryOrder: number | null;
  sha256: string;
  bytes: number;
};

type SkippedEntry = { path: string; reason: string; bodyChars: number };

type SourcesManifest = {
  snapshot: {
    repo: string;
    revision: string;
    syncedAt: string;
    tool: string;
    files: SnapshotFileEntry[];
    skipped: SkippedEntry[];
  } | null;
  internal: Array<{ path: string; title: string; visibility: "STAFF"; note: string }>;
};

function fail(message: string): never {
  console.error(`[knowledge:sync] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { revision: string | null; repo: string | null } {
  let revision: string | null = null;
  let repo: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--revision") revision = argv[index + 1] ?? null;
    else if (arg.startsWith("--revision=")) revision = arg.slice("--revision=".length);
    else if (arg === "--repo") repo = argv[index + 1] ?? null;
    else if (arg.startsWith("--repo=")) repo = arg.slice("--repo=".length);
  }
  return { revision, repo };
}

function runGit(args: string[], cwd: string): { ok: boolean; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) return { ok: false, stderr: String(result.error) };
  return { ok: result.status === 0, stderr: result.stderr ?? "" };
}

/** SUMMARY.md → 路径到 (标题, 顺序) 的映射；空链接 `()` 直接跳过。 */
function parseSummary(summaryText: string, warn: (message: string) => void): Map<string, { title: string; order: number }> {
  const map = new Map<string, { title: string; order: number }>();
  let order = 0;
  for (const line of summaryText.split(/\r?\n/)) {
    const matches = line.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g);
    for (const match of matches) {
      const title = match[1].trim();
      const target = match[2].trim();
      if (target === "") continue; // 空链接：规划中、尚无正文
      if (!target.toLowerCase().endsWith(".md")) continue;
      const normalized = decodeURIComponent(target).replace(/\\/g, "/").replace(/^\.\//, "");
      if (map.has(normalized)) {
        warn(`${SUMMARY_FILE} 中路径重复：${normalized}`);
        continue;
      }
      order += 1;
      map.set(normalized, { title, order });
    }
  }
  return map;
}

/** 可见正文字符数：去掉标题行、URL、图片、标记符号与空白后的 CJK/字母/数字数量。 */
function visibleBodyChars(markdown: string): number {
  let text = markdown;
  text = text.replace(/^#{1,6}\s+.*$/gm, ""); // 标题行
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // 图片
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 链接保留文字
  text = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/[`]/g, "")); // 代码保留内容
  text = text.replace(/[\[\]{}()<>#*_`>|~\-\s:：，。；;、,.\/\\+=!"'“”‘’…？?！]+/g, "");
  return text.length;
}

function walkMarkdown(root: string, current = root, into: string[] = []): string[] {
  for (const name of readdirSync(current).sort()) {
    const full = path.join(current, name);
    if (name === ".git") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) walkMarkdown(root, full, into);
    else if (/\.md$/i.test(name)) into.push(path.relative(root, full).replace(/\\/g, "/"));
  }
  return into;
}

function firstHeadingTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (match) return match[1].replace(/[*_`]/g, "").trim() || fallback;
  }
  return fallback;
}

function readManifest(): SourcesManifest {
  if (!existsSync(MANIFEST_PATH)) return { snapshot: null, internal: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as SourcesManifest;
  } catch (error) {
    fail(`来源清单无法解析：${MANIFEST_PATH}（${String(error)}）`);
  }
}

function main(): void {
  const { revision: revisionArg, repo: repoArg } = parseArgs(process.argv.slice(2));
  const existing = readManifest();
  const repo = repoArg ?? existing.snapshot?.repo ?? DEFAULT_REPO;
  const revision = revisionArg ?? existing.snapshot?.revision ?? null;
  if (!revision) {
    fail("缺少提交号：首次同步必须显式指定，例如 pnpm knowledge:sync -- --revision <40位sha>");
  }
  if (!/^[0-9a-f]{40}$/i.test(revision)) {
    fail(`提交号必须是完整的 40 位十六进制 sha，收到：${revision}`);
  }
  const normalizedRevision = revision.toLowerCase();

  const tempDir = path.join(os.tmpdir(), `pchospital-doc-sync-${process.pid}-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  try {
    console.log(`[knowledge:sync] git init → fetch ${normalizedRevision} ← ${repo}`);
    if (!runGit(["init", "-q", "."], tempDir).ok) fail("git init 失败");
    if (!runGit(["remote", "add", "origin", repo], tempDir).ok) fail("git remote add 失败");
    let fetched = runGit(["fetch", "-q", "--depth", "1", "origin", normalizedRevision], tempDir);
    if (!fetched.ok) {
      console.warn("[knowledge:sync] 浅取失败，尝试完整 fetch 该提交");
      fetched = runGit(["fetch", "-q", "origin", normalizedRevision], tempDir);
    }
    if (!fetched.ok) fail(`git fetch 失败：${fetched.stderr.trim()}`);
    if (!runGit(["checkout", "-q", "FETCH_HEAD"], tempDir).ok) fail("git checkout 失败");

    const sourceRoot = path.join(tempDir, "src");
    if (!existsSync(sourceRoot)) fail(`上游仓库没有 src/ 目录`);

    const warnings: string[] = [];
    const summaryPath = path.join(sourceRoot, SUMMARY_FILE);
    const summaryMap = existsSync(summaryPath)
      ? parseSummary(readFileSync(summaryPath, "utf8"), (message) => warnings.push(message))
      : new Map<string, { title: string; order: number }>();
    const markdownFiles = walkMarkdown(sourceRoot).filter((file) => file !== SUMMARY_FILE);

    const stagingDir = path.join(DATA_DIR, `.sync-staging-${process.pid}`);
    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(path.join(stagingDir, "docs"), { recursive: true });

    const files: SnapshotFileEntry[] = [];
    const skipped: SkippedEntry[] = [];
    for (const relative of markdownFiles) {
      // 统一为 LF 再计算哈希与落盘：仓库 .gitattributes 是 eol=lf，
      // 若按 checkout 的 CRLF 计算，新克隆（LF 工作树）会与清单哈希失配。
      const content = readFileSync(path.join(sourceRoot, relative), "utf8").replace(/\r\n/g, "\n");
      const bodyChars = visibleBodyChars(content);
      if (bodyChars < MIN_BODY_CHARS) {
        skipped.push({ path: relative, reason: "占位或纯目录内容", bodyChars });
        continue;
      }
      const summaryEntry = summaryMap.get(relative) ?? null;
      const fallbackTitle = path.basename(relative, ".md");
      const title = (summaryEntry?.title ?? "").trim() || firstHeadingTitle(content, fallbackTitle);
      const bytes = Buffer.byteLength(content, "utf8");
      const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
      const destination = path.join(stagingDir, "docs", relative);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, content, "utf8");
      files.push({
        path: relative,
        title,
        summaryOrder: summaryEntry?.order ?? null,
        sha256,
        bytes,
      });
    }
    files.sort((a, b) => (a.summaryOrder ?? 10_000) - (b.summaryOrder ?? 10_000) || a.path.localeCompare(b.path));

    if (existsSync(summaryPath)) {
      writeFileSync(
        path.join(stagingDir, SUMMARY_FILE),
        readFileSync(summaryPath, "utf8").replace(/\r\n/g, "\n"),
        "utf8",
      );
    }

    // 原子替换：先挪走旧 docs，再就位新内容；manifest 最后写。
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const oldDocs = path.join(SNAPSHOT_DIR, "docs");
    rmSync(oldDocs, { recursive: true, force: true });
    renameSync(path.join(stagingDir, "docs"), oldDocs);
    const oldSummary = path.join(SNAPSHOT_DIR, SUMMARY_FILE);
    if (existsSync(path.join(stagingDir, SUMMARY_FILE))) {
      rmSync(oldSummary, { force: true });
      renameSync(path.join(stagingDir, SUMMARY_FILE), oldSummary);
    }
    rmSync(stagingDir, { recursive: true, force: true });

    const manifest: SourcesManifest = {
      snapshot: {
        repo,
        revision: normalizedRevision,
        syncedAt: new Date().toISOString(),
        tool: "knowledge-sync@1",
        files,
        skipped,
      },
      internal:
        existing.internal.length > 0
          ? existing.internal
          : [
              {
                path: "internal-test/staff-internal-sample.md",
                title: "【内部测试资料】工作人员内部流程示例（非真实案例）",
                visibility: "STAFF",
                note: "明确标注的合成测试资料，仅用于验证可见性过滤，不得当作真实案例或真实校内知识。",
              },
            ],
    };
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    for (const warning of warnings) console.warn(`[knowledge:sync] 警告：${warning}`);
    console.log(
      `[knowledge:sync] 完成：${files.length} 篇正文（提交 ${normalizedRevision.slice(0, 10)}），` +
        `跳过 ${skipped.length} 个无正文文件` +
        (skipped.length > 0 ? `（${skipped.map((entry) => entry.path).join(", ")}）` : ""),
    );
    console.log(`[knowledge:sync] 快照：${path.relative(process.cwd(), SNAPSHOT_DIR)}`);
    console.log(`[knowledge:sync] 清单：${path.relative(process.cwd(), MANIFEST_PATH)}（internal 段已保留）`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
