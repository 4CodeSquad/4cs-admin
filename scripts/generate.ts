/**
 * `npm run db:generate` — drizzle-kit generate, run in a temp directory.
 *
 * This repo lives on an exFAT volume, where macOS writes a `._*` sidecar next
 * to every new file. drizzle-kit writes its migration snapshots and re-reads
 * the folder in the same run, finds the sidecar and fails to parse it as JSON.
 * Generating on the internal (APFS) disk and copying the result back avoids it.
 */
import { cpSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const repoDir = join(process.cwd(), "db/migrations");
const tmp = mkdtempSync(join(tmpdir(), "drizzle-"));

const clean = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    if (entry.split("/").pop()!.startsWith("._")) rmSync(join(dir, entry), { force: true });
  }
};

try {
  clean(repoDir);
  if (existsSync(repoDir)) cpSync(repoDir, tmp, { recursive: true });
  execFileSync("npx", ["drizzle-kit", "generate", ...process.argv.slice(2)], {
    stdio: "inherit",
    // drizzle-kit prefixes "./" to the out dir, so it must be relative.
    env: { ...process.env, DRIZZLE_OUT: relative(process.cwd(), tmp) },
  });
  cpSync(tmp, repoDir, { recursive: true });
  clean(repoDir);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
