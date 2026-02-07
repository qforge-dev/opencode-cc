# opencode-cc

OpenCode, supercharged. ⚡

## To Install 🔌

Add to "plugin" in `.opencode/opencode.json`:

```json
{
  "plugin": ["@qforge/opencode-cc"]
}
```

## Contributing 🤝

Install dependencies:

```bash
bun install
```

Build:

```bash
bun run build
```

## Notes 📝

### Child Session Worktrees

When the orchestrator creates a new child session, this plugin creates an isolated git worktree and creates the child session inside that worktree.

- Location: `.opencode/worktrees/`
- Cleanup: worktrees are not removed automatically; delete them with `git worktree remove <path>` (and optionally delete the associated branch) when you no longer need them.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
