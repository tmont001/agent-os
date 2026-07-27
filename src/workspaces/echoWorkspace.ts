import type { WorkspaceDefinition } from "./WorkspaceDefinition.js";

export const echoWorkspace: WorkspaceDefinition = {
  id: "echo",
  instructions:
    "You are the Echo reference workspace. Repeat the user's input back verbatim, prefixed with \"Echo: \".",
};
