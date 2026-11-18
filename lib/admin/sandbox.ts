/**
 * The admin sandbox: ONE named, persistent Vercel Sandbox that holds both the
 * memory file and the working data the `bash` tool computes over, so memory
 * and computation share the same persistent environment.
 *
 * - Looked up by name and created when missing (`Sandbox.getOrCreate`). It is
 *   never stopped by us: a persistent sandbox keeps its files across stops and
 *   resumes by itself on the next call.
 * - No network (`deny-all`): commands the model writes cannot reach the store
 *   API, the internet, or anything else. They only see files we put there.
 * - No environment variables are passed in, so there is no secret to read.
 * - Commands run as the sandbox's unprivileged default user, never `sudo`.
 *
 * No `server-only` import: this is used inside workflow steps, which are
 * bundled outside Next.js.
 */
import { Sandbox } from "@vercel/sandbox";
import {
  MAX_MEMORY_CHARS,
  MEMORY_HEADER,
  MEMORY_PATH,
  formatNoteLine,
  hasNote,
} from "@/lib/admin/memory";
import type { SaveMemoryInput } from "@/lib/admin/types";

const SANDBOX_NAME = process.env.ADMIN_SANDBOX_NAME?.trim() || "ship-it-shop-admin";
const WORK_DIR = "/vercel/sandbox";
export const DATA_DIR = `${WORK_DIR}/data`;
/** One command may run this long before the sandbox kills it. */
const COMMAND_TIMEOUT_MS = 30_000;
/** Per stream. Keeps one noisy command from filling the chat and the model context. */
const MAX_OUTPUT_CHARS = 12_000;
/** Data files older than this are removed when a conversation turn starts. */
const DATA_MAX_AGE_MIN = 120;

/** Returns the admin sandbox, creating it on first use. Concurrent first calls can race, so retry. */
export async function getAdminSandbox(): Promise<Sandbox> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await Sandbox.getOrCreate({
        name: SANDBOX_NAME,
        persistent: true,
        timeout: 10 * 60 * 1000,
        networkPolicy: "deny-all",
      });
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** The memory file's text, or null when it doesn't exist yet. */
export async function readMemoryFile(sandbox?: Sandbox): Promise<string | null> {
  const sbx = sandbox ?? (await getAdminSandbox());
  const buf = await sbx.readFileToBuffer({ path: MEMORY_PATH });
  return buf ? buf.toString("utf8") : null;
}

/**
 * Adds one note. Idempotent: a note that is already there (same text, ignoring
 * case and spacing) is reported as a duplicate and not written again, so a
 * retried step cannot add it twice.
 *
 * The write is a shell `>>` append, not read-modify-write, so two notes saved
 * at the same moment cannot overwrite each other. The note travels as a
 * positional argument, never inside the script text.
 */
export async function appendMemoryNote(
  kind: SaveMemoryInput["kind"],
  note: string,
  date: string,
): Promise<"saved" | "duplicate" | "full"> {
  const sbx = await getAdminSandbox();
  const existing = (await readMemoryFile(sbx)) ?? "";
  if (hasNote(existing, note)) return "duplicate";
  const line = formatNoteLine(kind, note, date);
  if (existing.length + line.length + 1 > MAX_MEMORY_CHARS) return "full";
  const result = await sbx.runCommand({
    cmd: "bash",
    args: [
      "-c",
      'set -e; [ -f "$2" ] || printf "%s\\n" "$3" > "$2"; printf "%s\\n" "$1" >> "$2"',
      "_",
      line,
      MEMORY_PATH,
      MEMORY_HEADER.trimEnd(),
    ],
    timeoutMs: 10_000,
  });
  if (result.exitCode !== 0) throw new Error("Memory write failed");
  return "saved";
}

/** Writes a dataset as JSON for `bash` to compute over. Returns its path. */
export async function writeDataFile(name: string, rows: unknown[]): Promise<string> {
  const sbx = await getAdminSandbox();
  const path = `${DATA_DIR}/${name}.json`;
  await sbx.writeFiles([{ path, content: JSON.stringify(rows) }]);
  return path;
}

/** Best effort: drops stale data files so old store data is not mistaken for current. */
export async function pruneOldData(sandbox: Sandbox): Promise<void> {
  await sandbox
    .runCommand({
      cmd: "bash",
      args: ["-c", `find ${DATA_DIR} -type f -mmin +${DATA_MAX_AGE_MIN} -delete 2>/dev/null; true`],
      timeoutMs: 10_000,
    })
    .catch(() => {});
}

export interface BashOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
}

function clip(text: string): { text: string; cut: boolean } {
  if (text.length <= MAX_OUTPUT_CHARS) return { text, cut: false };
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[output cut: ${text.length - MAX_OUTPUT_CHARS} more characters]`,
    cut: true,
  };
}

/**
 * Runs one command with `bash -lc` in the sandbox. A non-zero exit code is a
 * normal outcome (returned); only a failure to reach the sandbox throws.
 */
export async function runBash(command: string): Promise<BashOutcome> {
  const sbx = await getAdminSandbox();
  const result = await sbx.runCommand({
    cmd: "bash",
    args: ["-lc", command],
    cwd: WORK_DIR,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  const [out, err] = await Promise.all([result.stdout(), result.stderr()]);
  const stdout = clip(out);
  const stderr = clip(err);
  return {
    stdout: stdout.text,
    stderr: stderr.text,
    exitCode: result.exitCode,
    truncated: stdout.cut || stderr.cut,
  };
}
