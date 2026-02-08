import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

import { findOpencodeBinary } from "./find-opencode";

export type OpencodeServer = {
  url: string;
  getOutput: () => string;
  stop: () => Promise<void>;
};

export async function startOpencodeServer(input: {
  cwd: string;
  port: number;
  hostname: string;
  config: Record<string, unknown>;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
}): Promise<OpencodeServer> {
  const bin = await findOpencodeBinary();
  const args = [
    "serve",
    `--hostname=${input.hostname}`,
    `--port=${input.port}`,
  ];

  const proc = spawn(bin, args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(input.config ?? {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const outputChunks: Array<string> = [];
  const url = await waitForListeningUrl(proc, outputChunks, input.timeoutMs, input.onOutput);
  return {
    url,
    getOutput: () => outputChunks.join(""),
    stop: async () => {
      await stopProcess(proc);
    },
  };
}

async function waitForListeningUrl(
  proc: ChildProcess,
  outputChunks: Array<string>,
  timeoutMs: number,
  onOutput: ((chunk: string) => void) | undefined,
): Promise<string> {
  const pushChunk = (chunk: any) => {
    const str = String(chunk);
    outputChunks.push(str);
    onOutput?.(str);
  };

  proc.stdout?.on("data", pushChunk);
  proc.stderr?.on("data", pushChunk);

  const startedAt = Date.now();
  let buffered = "";

  return await new Promise<string>((resolve, reject) => {
    const timer = setInterval(() => {
      buffered = outputChunks.join("");
      const lines = buffered.split("\n");
      for (const line of lines) {
        if (!line.startsWith("opencode server listening")) continue;
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
        if (!match) continue;
        const url = match[1] ?? null;
        if (!url || !url.length) continue;
        clearInterval(timer);
        resolve(url);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(buildTimeoutError(buffered, timeoutMs)));
      }
    }, 20);

    proc.once("exit", (code) => {
      clearInterval(timer);
      buffered = outputChunks.join("");
      reject(new Error(`opencode exited with code ${String(code)}\n${buffered}`));
    });

    proc.once("error", (err) => {
      clearInterval(timer);
      buffered = outputChunks.join("");
      reject(new Error(`opencode failed to start: ${String(err)}\n${buffered}`));
    });
  });
}

function buildTimeoutError(output: string, timeoutMs: number): string {
  const trimmed = output.trim();
  if (!trimmed.length) return `Timeout waiting for opencode server after ${timeoutMs}ms`;
  return `Timeout waiting for opencode server after ${timeoutMs}ms\n${trimmed}`;
}

async function stopProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null) return;

  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
  });

  proc.kill("SIGTERM");
  setTimeout(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  }, 1500);

  await Promise.race([
    exited,
    Bun.sleep(3000).then(() => undefined),
  ]);
}
