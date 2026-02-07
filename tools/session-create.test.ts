import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk";

import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../session-registry.ts";
import { SessionWorktreeManager } from "../worktrees/session-worktree-manager.ts";
import { createSessionCreateTool } from "./session-create.ts";

describe("session_create worktree-per-session", () => {
  test("creates child session in a git worktree directory", async () => {
    const repoRoot = await createTempGitRepo();
    try {
      const created: Array<any> = [];
      const client = {
        session: {
          create: async (input: any) => {
            created.push(input);
            return {
              error: null,
              data: {
                id: "child-1",
                title: input?.body?.title ?? "child",
              },
            };
          },
        },
      } as unknown as OpencodeClient;

      const registry = new SessionRegistry();
      const worktreeManager = new SessionWorktreeManager();
      const tool = createSessionCreateTool(client, registry, worktreeManager);

      await tool.execute(
        { title: "Implement feature X" },
        {
          sessionID: "orch-1",
          messageID: "msg-1",
          agent: "orchestrator",
          directory: repoRoot,
          worktree: repoRoot,
          abort: new AbortController().signal,
          metadata: (input: any) => {
            void input;
          },
          ask: async (input: any) => {
            void input;
          },
        },
      );

      expect(created.length).toBe(1);
      const directory = created[0]?.query?.directory ?? null;
      expect(typeof directory).toBe("string");
      expect(String(directory)).toContain(path.join(repoRoot, ".opencode", "worktrees"));

      const top = runGit(String(directory), ["rev-parse", "--show-toplevel"]);
      expect(top.status).toBe(0);
      expect(top.stdout.trim()).toBe(String(directory));

      expect(registry.getChildWorkspaceDirectory("child-1")).toBe(String(directory));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function createTempGitRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-cc-"));
  runGit(dir, ["init"]);
  await writeFile(path.join(dir, "README.md"), "temp\n");
  runGit(dir, ["add", "README.md"]);
  runGit(dir, ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "init"]);
  return dir;
}

function runGit(cwd: string, args: Array<string>): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });

  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}
