import { describe, expect, test } from "bun:test";
import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionRegistry } from "../session-registry";
import { createSessionStatusTool } from "./session-status";

describe("session_status", () => {
  test("reports state transitions and derived progress", async () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));
    const registry = new SessionRegistry(storageDirectory);
    registry.registerChildSession({
      childSessionID: "child-1",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "Task",
      createdAt: 1000,
      workspaceDirectory: null,
      workspaceBranch: null,
    });

    let busy = false;

    const client = {
      session: {
        status: async () => ({
          error: null,
          data: {
            "child-1": { type: busy ? "busy" : "idle" },
          },
        }),
        messages: async () => ({
          error: null,
          data: [
            {
              info: { role: "assistant", id: "m1" },
              parts: [{ type: "text", text: "Latest output" }],
            },
          ],
        }),
      },
    } as unknown as OpencodeClient;

    const tool = createSessionStatusTool(client, registry);

    const context = {
      sessionID: "orch-1",
      messageID: "msg-1",
      agent: "orchestrator",
      directory: "/home/michal/Projects/opencode-cc",
      worktree: "/home/michal/Projects/opencode-cc",
      abort: new AbortController().signal,
      metadata: (input: any) => {
        void input;
      },
      ask: async (input: any) => {
        void input;
      },
    };

    const createdRaw = await tool.execute(
      { sessionID: "child-1", refresh: null },
      context as any
    );
    const created = JSON.parse(createdRaw);
    expect(created.status).toBe("ok");
    expect(created.state).toBe("created");
    expect(created.progress).toBe("pending");

    registry.markPromptSent("child-1", 2000);
    busy = true;

    const runningRaw = await tool.execute(
      { sessionID: "child-1", refresh: null },
      context as any
    );
    const running = JSON.parse(runningRaw);
    expect(running.state).toBe("prompt_sent");
    expect(running.progress).toBe("running");

    registry.markResultReceived("child-1", 3000, "Done");
    busy = false;

    const doneRaw = await tool.execute(
      { sessionID: "child-1", refresh: null },
      context as any
    );
    const done = JSON.parse(doneRaw);
    expect(done.state).toBe("result_received");
    expect(done.progress).toBe("done");
  });

  test("refresh updates the last assistant excerpt", async () => {
    const storageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-cc-registry-"));
    const registry = new SessionRegistry(storageDirectory);
    registry.registerChildSession({
      childSessionID: "child-2",
      orchestratorSessionID: "orch-1",
      orchestratorDirectory: "/repo",
      title: "Task",
      createdAt: 1000,
      workspaceDirectory: null,
      workspaceBranch: null,
    });

    const client = {
      session: {
        status: async () => ({
          error: null,
          data: { "child-2": { type: "idle" } },
        }),
        messages: async () => ({
          error: null,
          data: [
            {
              info: { role: "assistant", id: "m2" },
              parts: [{ type: "text", text: "Hello from child" }],
            },
          ],
        }),
      },
    } as unknown as OpencodeClient;

    const tool = createSessionStatusTool(client, registry);

    const raw = await tool.execute({ sessionID: "child-2", refresh: true }, {
      sessionID: "orch-1",
      messageID: "msg-1",
      agent: "orchestrator",
      directory: "/home/michal/Projects/opencode-cc",
      worktree: "/home/michal/Projects/opencode-cc",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    } as any);

    const parsed = JSON.parse(raw);
    expect(parsed.lastAssistantMessageExcerpt).toBe("Hello from child");
  });
});
