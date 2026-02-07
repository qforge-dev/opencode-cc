import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import path from "node:path";

import { SessionRegistry } from "../session-registry";
import { SessionWorktreeManager } from "../worktrees/session-worktree-manager";
import { createSessionCreateTool } from "./session-create";

describe("session_create worktree-per-session", () => {
  test("creates child session in a worktree directory", async () => {
    const repoRoot = "/repo";
    const created: Array<any> = [];
    const worktreeCreates: Array<any> = [];

    const expectedWorktreeDirectory = path.join(
      repoRoot,
      ".opencode",
      "worktrees",
      "wt_1"
    );

    const client = {
      worktree: {
        create: async (input: any) => {
          worktreeCreates.push(input);
          return {
            error: null,
            data: {
              name: "wt_1",
              branch: "opencode/session/wt_1",
              directory: expectedWorktreeDirectory,
            },
          };
        },
        remove: async (input: any) => {
          void input;
          return { error: null, data: true };
        },
      },
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
    const worktreeManager = new SessionWorktreeManager(client);
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
      }
    );

    expect(worktreeCreates.length).toBe(1);
    const worktreeName = worktreeCreates[0]?.worktreeCreateInput?.name ?? null;
    expect(typeof worktreeName).toBe("string");
    expect(String(worktreeName)).toContain("implement_feature_x");

    expect(created.length).toBe(1);
    const directory = created[0]?.directory ?? null;
    expect(directory).toBe(expectedWorktreeDirectory);
    expect(registry.getChildWorkspaceDirectory("child-1")).toBe(
      expectedWorktreeDirectory
    );
  });
});
