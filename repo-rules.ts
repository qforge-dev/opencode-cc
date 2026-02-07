export const REPO_RULES_TEXT = [
  "- Always run `bun run typecheck` and fix TS errors before finishing.",
  "- Prefer `function` declarations over arrow functions assigned to variables.",
  "- Place helper functions below their first usage and rely on hoisting.",
  "- Do not leave comments in code.",
  "- Encapsulate related logic in classes with private methods over standalone helpers.",
  "- Avoid optional fields in types/interfaces; use explicit nullable types instead.",
  "- Put each new class in its own file.",
].join("\n");
