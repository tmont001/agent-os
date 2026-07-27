import { z } from "zod";

export const RunRequestSchema = z
  .object({
    workspaceId: z.string(),
    input: z.string(),
  })
  .strict();

export type RunRequestBody = z.infer<typeof RunRequestSchema>;
