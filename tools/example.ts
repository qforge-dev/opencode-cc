import { tool } from "@opencode-ai/plugin";

type ToolDefinition = ReturnType<typeof tool>;

function createExampleTool(): ToolDefinition {
  return tool({
    description: "Example tool that does nothing",
    args: {},
    async execute(_args, _context) {
      try {
        return "Successfully executed example tool.";
      } catch (error) {
        return `Failed to execute example tool: ${error}`;
      }
    },
  });
}

export { createExampleTool };
