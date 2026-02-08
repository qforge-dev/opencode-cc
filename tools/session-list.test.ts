import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../session-registry";
import { createSessionListTool } from "./session-list";

describe("session_list", () => {
  test("returns child sessions created by the current orchestrator session", async () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));
    const registry = new SessionRegistry(storageDirectory);

    registry.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "Task A",
      createdAt: 1000,
      workspaceDirectory: "/tmp/a",
      workspaceBranch: "branch-a",
    });

    registry.registerChildSession({
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "Task B",
      createdAt: 2000,
      workspaceDirectory: "/tmp/b",
      workspaceBranch: "branch-b",
    });

    registry.registerChildSession({
      childSessionID: "child-3",
      orchestratorSessionID: "orch-2",
      orchestratorDirectory: "/repo",
      title: "Other",
      createdAt: 1500,
      workspaceDirectory: null,
      workspaceBranch: null,
    });

    const tool = createSessionListTool(registry);

    const raw = await tool.execute(
      {},
      {
        sessionID: "orch-1",
        messageID: "msg-1",
        agent: "orchestrator",
        directory: "/home/michal/Projects/opencode-cc",
        worktree: "/home/michal/Projects/opencode-cc",
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      }
    );

    const parsed = JSON.parse(raw);
    expect(parsed.status).toBe("ok");
    expect(parsed.count).toBe(2);

    const ids = (parsed.children as Array<any>).map((c) => c.childSessionID);
    expect(ids).toEqual(["child-1", "child-2"]);
  });
});
