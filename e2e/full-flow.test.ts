import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

import { createTempRepo } from "./harness/temp-repo";
import { getFreePort } from "./harness/ports";
import { startMockOpenAiServer } from "./harness/mock-openai";
import { startOpencodeServer } from "./harness/opencode-server";
import { waitForValue } from "./harness/wait";

const execFileAsync = promisify(execFile);

const enabled = process.env.OPENCODE_E2E === "1";
const run = enabled ? test : test.skip;

describe("opencode-cc full flow (e2e)", () => {
  run(
    "orchestrator delegates to child in worktree and replies with result",
    async () => {
      const log = createLogger(true);

      console.log(
        [
          "[e2e] Mode: build",
          "[e2e] Not read-only; file changes and shell commands are allowed.",
        ].join("\n"),
      );

      const pluginRootDir = path.resolve(import.meta.dir, "..");
      log(`pluginRootDir=${pluginRootDir}`);
      await execFileAsync("bun", ["run", "build"], { cwd: pluginRootDir });

      const mockPort = await getFreePort();
      const mock = await startMockOpenAiServer({ hostname: "127.0.0.1", port: mockPort });
      log(`mockBaseUrl=${mock.baseUrl}`);
      const tempRepo = await createTempRepo({ prefix: "opencode-e2e-", pluginRootDir });
      log(`tempRepo=${tempRepo.rootDir}`);

      const fileConfig = buildOpencodeConfig({
        mockBaseUrl: `${mock.baseUrl}/v1`,
      });
      await fs.writeFile(
        path.join(tempRepo.rootDir, ".opencode", "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", ...fileConfig }, null, 2) + "\n",
        "utf8",
      );
      log("wrote .opencode/opencode.json");

      const serverPort = await getFreePort();
      const server = await startOpencodeServer({
        cwd: tempRepo.rootDir,
        port: serverPort,
        hostname: "127.0.0.1",
        timeoutMs: 20000,
        config: { logLevel: "ERROR" },
        onOutput: (chunk) => {
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.length) continue;
            if (trimmed.includes("server listening") || trimmed.toLowerCase().includes("error") || trimmed.toLowerCase().includes("warn")) {
              log(`[opencode] ${trimmed}`);
            }
          }
        },
      });
      log(`serverUrl=${server.url}`);

      try {
        const client = createOpencodeClient({
          baseUrl: server.url,
          directory: tempRepo.rootDir,
        });

        const toolIDs = await client.tool.ids({});
        expect((toolIDs as any).error ?? null).toBeNull();
        const ids = (toolIDs as any).data ?? toolIDs ?? [];
        log(`toolIDs=${JSON.stringify(ids)}`);
        expect(ids).toContain("session_create");
        expect(ids).toContain("session_prompt");
        expect(ids).toContain("session_status");
        expect(ids).toContain("session_list");

        const agents = await client.app.agents({});
        expect((agents as any).error ?? null).toBeNull();
        const agentData = (agents as any).data ?? agents ?? [];
        const agentNames = agentData.map((a: any) => a.name);
        log(`agents=${JSON.stringify(agentNames)}`);
        expect(agentNames).toContain("orchestrator");

        const created = await client.session.create({
          title: "E2E Orchestrator",
        });
        expect((created as any).error ?? null).toBeNull();
        const createdData = (created as any).data ?? created;
        const orchestratorSessionID = createdData?.id;
        expect(typeof orchestratorSessionID).toBe("string");
        if (!orchestratorSessionID) throw new Error("Missing orchestrator session id");
        log(`orchestratorSessionID=${orchestratorSessionID}`);

        const first = await client.session.prompt({
          sessionID: orchestratorSessionID,
          agent: "orchestrator",
          parts: [{ type: "text", text: "git status and tell me whats going on" }],
        });
        expect((first as any).error ?? null).toBeNull();
        log(`initialPromptMessageID=${(first as any).info?.id ?? null}`);
        log("waiting for orchestrator final reply (child completion forwarded)");

        try {
          await waitForValue({
            timeoutMs: 120000,
            intervalMs: 500,
            getValue: async () => {
              const msgs = await client.session.messages({ sessionID: orchestratorSessionID, limit: 100 });
              const error = (msgs as any).error ?? null;
              if (error) throw error;
              return (msgs as any).data ?? msgs ?? [];
            },
            isReady: (messages) => {
              const text = findLatestAssistantText(messages);
              return text.includes("Here is what is going on:");
            },
            onPoll: ({ attempt, elapsedMs, value }) => {
              if (attempt % 10 !== 0) return;
              const latest = findLatestAssistantText(value as any);
              log(`waitForReply attempt=${attempt} elapsedMs=${elapsedMs} latest=${JSON.stringify(latest.slice(0, 160))}`);
            },
          });
        } catch (err) {
          const msgs = await client.session.messages({ sessionID: orchestratorSessionID, limit: 100 });
          const msgData = (msgs as any).data ?? msgs ?? [];
          const latest = findLatestAssistantText(msgData);
          const requests = mock.getRequests();
          const requestModels = requests
            .filter((r) => r.url.includes("chat"))
            .map((r) => {
              const body = r.body as any;
              const msgs = Array.isArray(body?.messages) ? body.messages : [];
              const lastUser = [...msgs]
                .reverse()
                .find((m: any) => m && m.role === "user" && typeof m.content === "string")?.content;
              return {
                model: body?.model ?? null,
                stream: body?.stream ?? null,
                lastUser: typeof lastUser === "string" ? lastUser.slice(0, 200) : null,
              };
            });
          const registryPath = path.join(tempRepo.rootDir, ".opencode", "opencode-cc", "session-registry.json");
          let registrySummary: string | null = null;
          try {
            const raw = await fs.readFile(registryPath, "utf8");
            const store = JSON.parse(raw) as any;
            const sessionIDs = Object.keys(store?.sessions ?? {});
            const firstChild = sessionIDs.length ? store.sessions[sessionIDs[0]] : null;
            registrySummary = JSON.stringify({
              sessionIDs,
              firstChildState: firstChild?.tracking?.state ?? null,
              workspaceDirectory: firstChild?.registration?.workspaceDirectory ?? null,
            });
          } catch {
            registrySummary = null;
          }

          const statuses = await client.session.status({});
          const statusesData = (statuses as any).data ?? statuses ?? null;

          throw new Error(
            [
              `E2E did not converge: ${String(err)}`,
              `Latest orchestrator assistant text: ${latest}`,
              `Mock model requests: ${JSON.stringify(requestModels)}`,
              `Registry: ${registrySummary}`,
              `Session status keys: ${statusesData ? Object.keys(statusesData).slice(0, 10).join(",") : "null"}`,
              `opencode output (tail): ${server.getOutput().slice(-8000)}`,
            ].join("\n"),
          );
        }

        const finalMessages = await client.session.messages({ sessionID: orchestratorSessionID, limit: 100 });
        expect((finalMessages as any).error ?? null).toBeNull();
        const finalMessageData = (finalMessages as any).data ?? finalMessages ?? [];
        const finalText = findLatestAssistantText(finalMessageData);
        log(`finalText=${JSON.stringify(finalText.slice(0, 400))}`);
        expect(finalText).toContain("[Child session");
        expect(finalText).toContain("completed");

        const registryPath = path.join(tempRepo.rootDir, ".opencode", "opencode-cc", "session-registry.json");
        await waitForValue({
          timeoutMs: 20000,
          intervalMs: 200,
          getValue: async () => {
            const raw = await fs.readFile(registryPath, "utf8");
            return JSON.parse(raw) as any;
          },
          isReady: (store) => {
            const count = store?.sessions ? Object.keys(store.sessions).length : 0;
            return count >= 1;
          },
        });

        const store = JSON.parse(await fs.readFile(registryPath, "utf8")) as any;
        const childIDs = Object.keys(store.sessions ?? {});
        expect(childIDs.length).toBeGreaterThan(0);
        const firstChild = store.sessions[childIDs[0]];
        log(`childIDs=${JSON.stringify(childIDs)}`);
        const workspaceDir = firstChild?.registration?.workspaceDirectory ?? null;
        expect(typeof workspaceDir).toBe("string");
        if (!workspaceDir) throw new Error("Missing workspace directory");
        log(`workspaceDir=${workspaceDir}`);
        expect(workspaceDir).not.toBe(tempRepo.rootDir);
        const workspaceStat = await fs.stat(workspaceDir);
        expect(workspaceStat.isDirectory()).toBe(true);
        const dotGit = path.join(workspaceDir, ".git");
        const dotGitStat = await fs.stat(dotGit);
        expect(dotGitStat.isFile()).toBe(true);
      } finally {
        await server.stop();
        await mock.stop();
        await tempRepo.cleanup();
      }
    },
    180000,
  );
});

function buildOpencodeConfig(input: { mockBaseUrl: string }): Record<string, unknown> {
  const models = {
    orchestrator: {
      name: "orchestrator",
      tool_call: true,
      reasoning: false,
      temperature: true,
      limit: { context: 32000, output: 4000 },
    },
    plan: {
      name: "plan",
      tool_call: false,
      reasoning: false,
      temperature: true,
      limit: { context: 32000, output: 4000 },
    },
    build: {
      name: "build",
      tool_call: true,
      reasoning: false,
      temperature: true,
      limit: { context: 32000, output: 4000 },
    },
  };

  return {
    logLevel: "ERROR",
    plugin: ["@qforge/opencode-cc"],
    provider: {
      mock: {
        api: "openai",
        name: "mock",
        models,
        options: {
          baseURL: input.mockBaseUrl,
          apiKey: "test",
          timeout: false,
        },
      },
    },
    model: "mock/orchestrator",
    small_model: "mock/orchestrator",
    agent: {
      plan: { model: "mock/plan" },
      build: { model: "mock/build" },
      orchestrator: { model: "mock/orchestrator" },
      title: { model: "mock/orchestrator" },
      summary: { model: "mock/orchestrator" },
      compaction: { model: "mock/orchestrator" },
      explore: { model: "mock/orchestrator" },
      general: { model: "mock/orchestrator" },
    },
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      external_directory: "allow",
      webfetch: "allow",
      websearch: "allow",
      doom_loop: "allow",
      question: "allow",
      todowrite: "allow",
      todoread: "allow",
    },
  };
}

function findLatestAssistantText(messages: Array<{ info: any; parts: Array<any> }>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg) continue;
    if (msg.info?.role !== "assistant") continue;
    return extractTextFromParts(msg.parts ?? []);
  }
  return "";
}

function extractTextFromParts(parts: Array<any>): string {
  return parts
    .filter((p) => p && p.type === "text" && !p.ignored)
    .map((p) => String(p.text ?? ""))
    .join("\n");
}

function createLogger(enabled: boolean): (line: string) => void {
  if (!enabled) return () => {};
  return (line) => {
    const ts = new Date().toISOString();
    console.log(`[e2e ${ts}] ${line}`);
  };
}
