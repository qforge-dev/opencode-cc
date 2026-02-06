import type { AgentConfig } from "@opencode-ai/sdk";

export const agent: AgentConfig = {
  name: "opencode-agent-example",
  description: "Example agent that does nothing",
  mode: "primary",
  tools: {
    read: true,
    write: true,
    edit: true,
    glob: true,
    grep: true,
    bash: false,
  },
  prompt: `You are an example agent that does nothing.`,
} as const;

export default agent;
