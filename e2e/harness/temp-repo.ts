import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type TempRepo = {
  rootDir: string;
  pluginRootDir: string;
  cleanup: () => Promise<void>;
};

export async function createTempRepo(input: {
  prefix: string;
  pluginRootDir: string;
}): Promise<TempRepo> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), input.prefix));
  await runGit(rootDir, ["init"]);
  await runGit(rootDir, ["config", "user.email", "e2e@example.com"]);
  await runGit(rootDir, ["config", "user.name", "E2E"]);

  await fs.writeFile(path.join(rootDir, "README.md"), "# Temp Repo\n", "utf8");
  await fs.writeFile(path.join(rootDir, ".gitignore"), ".opencode/\n", "utf8");

  await runGit(rootDir, ["add", "README.md", ".gitignore"]);
  await runGit(rootDir, ["commit", "-m", "init"]);

  await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, ".opencode", "package.json"),
    JSON.stringify(
      {
        name: "temp-opencode-e2e",
        private: true,
        dependencies: {
          "@qforge/opencode-cc": `file:${input.pluginRootDir}`,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  await fs.writeFile(
    path.join(rootDir, ".opencode", "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      plugin: ["@qforge/opencode-cc"],
    }, null, 2) + "\n",
    "utf8",
  );

  await runBunInstall(path.join(rootDir, ".opencode"));

  return {
    rootDir,
    pluginRootDir: input.pluginRootDir,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

async function runGit(cwd: string, args: Array<string>): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function runBunInstall(cwd: string): Promise<void> {
  await execFileAsync("bun", ["install"], { cwd, env: { ...process.env } });
}
