import type { Config } from "@opencode-ai/sdk";

export const command: NonNullable<Config["command"]>[string] = {
  description: "Example command that does nothing",
  template: "Use the example tool to do nothing.",
};

export default command;
