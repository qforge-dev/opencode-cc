import fs from "node:fs";
import path from "node:path";

export type PromptPathRewriteResult = {
  text: string;
  rewrittenCount: number;
  errors: Array<string>;
};

export function rewritePromptPathsForChildWorktree(input: {
  text: string;
  orchestratorDirectory: string;
  childWorkspaceDirectory: string;
}): PromptPathRewriteResult {
  const errors: Array<string> = [];
  let rewrittenCount = 0;

  const sourceRoot =
    findGitRoot(input.orchestratorDirectory) ??
    path.resolve(input.orchestratorDirectory);
  const targetRoot =
    findGitRoot(input.childWorkspaceDirectory) ??
    path.resolve(input.childWorkspaceDirectory);

  const orchestratorDirectory = path.resolve(input.orchestratorDirectory);
  const childWorkspaceDirectory = path.resolve(input.childWorkspaceDirectory);

  const rewritten = input.text.replace(
    /(^|[\s\(\[\{<"'`])((?:\/|\.\/|\.\.\/)[^\s\n\r\t"'`<>\)\]\}]+)(?=$|[\s\)\]\}>"'`,;])/g,
    (full, prefix: string, token: string) => {
      try {
        const next = rewriteToken({
          token,
          sourceRoot,
          targetRoot,
          orchestratorDirectory,
          childWorkspaceDirectory,
        });

        if (next === null || next === token) return full;
        rewrittenCount += 1;
        return `${prefix}${next}`;
      } catch (error) {
        errors.push(`Failed to rewrite token '${token}': ${String(error)}`);
        return full;
      }
    }
  );

  return {
    text: rewritten,
    rewrittenCount,
    errors,
  };
}

function rewriteToken(input: {
  token: string;
  sourceRoot: string;
  targetRoot: string;
  orchestratorDirectory: string;
  childWorkspaceDirectory: string;
}): string | null {
  const { core: withoutTrailing, trailing } = splitTrailingPunctuation(input.token);
  const { basePath, suffix } = splitReferenceSuffix(withoutTrailing);

  const rewrittenBase = rewritePathLike({
    pathLike: basePath,
    sourceRoot: input.sourceRoot,
    targetRoot: input.targetRoot,
    orchestratorDirectory: input.orchestratorDirectory,
    childWorkspaceDirectory: input.childWorkspaceDirectory,
  });

  if (rewrittenBase === null) return null;
  return `${rewrittenBase}${suffix}${trailing}`;
}

function rewritePathLike(input: {
  pathLike: string;
  sourceRoot: string;
  targetRoot: string;
  orchestratorDirectory: string;
  childWorkspaceDirectory: string;
}): string | null {
  const candidate = input.pathLike;

  if (candidate.startsWith("/")) {
    const abs = path.resolve(candidate);
    const mapped = mapAbsolutePath({
      absolutePath: abs,
      sourceRoot: input.sourceRoot,
      targetRoot: input.targetRoot,
      childWorkspaceDirectory: input.childWorkspaceDirectory,
    });
    if (mapped !== null) return mapped;

    const fallback = mapAbsolutePath({
      absolutePath: abs,
      sourceRoot: input.orchestratorDirectory,
      targetRoot: input.childWorkspaceDirectory,
      childWorkspaceDirectory: input.childWorkspaceDirectory,
    });
    return fallback;
  }

  if (candidate.startsWith("./") || candidate.startsWith("../")) {
    const abs = path.resolve(input.orchestratorDirectory, candidate);
    const mapped = mapAbsolutePath({
      absolutePath: abs,
      sourceRoot: input.sourceRoot,
      targetRoot: input.targetRoot,
      childWorkspaceDirectory: input.childWorkspaceDirectory,
    });
    if (mapped !== null) return mapped;
    return null;
  }

  return null;
}

function mapAbsolutePath(input: {
  absolutePath: string;
  sourceRoot: string;
  targetRoot: string;
  childWorkspaceDirectory: string;
}): string | null {
  if (!isSubpathOrEqual(input.absolutePath, input.sourceRoot)) return null;
  const relFromRoot = path.relative(input.sourceRoot, input.absolutePath);
  const targetAbs = path.join(input.targetRoot, relFromRoot);
  const relFromChild = path.relative(input.childWorkspaceDirectory, targetAbs);
  return normalizeToPosix(relFromChild);
}

function splitTrailingPunctuation(token: string): { core: string; trailing: string } {
  let core = token;
  let trailing = "";

  while (core.length > 0) {
    const last = core[core.length - 1];
    if (!last) break;
    if (last === ")" || last === "]" || last === "}" || last === "." || last === "," || last === ";") {
      trailing = last + trailing;
      core = core.slice(0, -1);
      continue;
    }
    break;
  }

  return { core, trailing };
}

function splitReferenceSuffix(token: string): { basePath: string; suffix: string } {
  const hashMatch = token.match(/(#L\d+(?:C\d+)?)$/);
  if (hashMatch) {
    const suffix = hashMatch[1] ?? "";
    return {
      basePath: token.slice(0, Math.max(0, token.length - suffix.length)),
      suffix,
    };
  }

  const colonMatch = token.match(/(:\d+(?::\d+)?)$/);
  if (colonMatch) {
    const suffix = colonMatch[1] ?? "";
    return {
      basePath: token.slice(0, Math.max(0, token.length - suffix.length)),
      suffix,
    };
  }

  return { basePath: token, suffix: "" };
}

function normalizeToPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function isSubpathOrEqual(childPath: string, parentPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  if (rel === "") return true;
  if (rel.startsWith(".." + path.sep)) return false;
  if (rel === "..") return false;
  return !path.isAbsolute(rel);
}

function findGitRoot(startDirectory: string): string | null {
  let current = path.resolve(startDirectory);

  while (true) {
    const marker = path.join(current, ".git");
    try {
      if (fs.existsSync(marker)) return current;
    } catch {
      return null;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
