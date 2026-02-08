import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "./session-registry";

describe("SessionRegistry persistence", () => {
  test("persists registrations and updates across instances", () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));

    const a = new SessionRegistry(storageDirectory);
    a.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "Task",
      createdAt: 1000,
      workspaceDirectory: "/tmp/worktree-child-1",
      workspaceBranch: "branch-1",
    });
    a.markPlanningPromptSent("child-1", { prompt: "Do X" });
    a.markAwaitingUserAnswers("child-1", "## Plan", "## Questions");
    a.setLastDeliveredAssistantMessageID("child-1", "m1");
    a.markPromptSent("child-1", 2000);

    const b = new SessionRegistry(storageDirectory);
    expect(b.getOrchestratorSessionID("child-1")).toBe("orch-1");
    expect(b.getChildWorkspaceDirectory("child-1")).toBe("/tmp/worktree-child-1");
    expect(b.isAwaitingUserAnswers("child-1")).toBe(true);
    expect(b.getPendingExecutionPrompt("child-1")?.prompt ?? null).toBe("Do X");
    expect(b.getLastDeliveredAssistantMessageID("child-1")).toBe("m1");

    const listed = b.listChildSessions("orch-1");
    expect(listed.length).toBe(1);
    expect(listed[0]?.childSessionID).toBe("child-1");
    expect(listed[0]?.state).toBe("prompt_sent");

    const awaiting = b.getChildSessionsAwaitingAnswers("orch-1");
    expect(awaiting).toEqual(["child-1"]);
  });
});
