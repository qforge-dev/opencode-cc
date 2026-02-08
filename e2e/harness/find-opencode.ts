import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

export async function findOpencodeBinary(): Promise<string> {
  const candidates = [
    process.env.OPENCODE_BIN,
    "/home/michal/.opencode/bin/opencode",
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) return candidate;
  }

  const pathCandidates = await resolveFromPath("opencode");
  for (const resolved of pathCandidates) {
    if (await isExecutableFile(resolved)) return resolved;
  }

  throw new Error(
    "Failed to locate opencode binary. Set OPENCODE_BIN or ensure opencode is on PATH.",
  );
}

async function resolveFromPath(exe: string): Promise<Array<string>> {
  const envPath = process.env.PATH ?? "";
  const parts = envPath.split(path.delimiter).filter(Boolean);
  return parts.map((p) => path.join(p, exe));
}

async function isExecutableFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
