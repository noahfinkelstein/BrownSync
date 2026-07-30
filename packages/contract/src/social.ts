import { z } from "zod";

export const MeOutSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
  })
  .meta({ id: "Me" });
export type MeOut = z.infer<typeof MeOutSchema>;
