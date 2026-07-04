// TEMPLATE: demo schemas for the example module.
import { z } from 'zod';

export const exampleParamsSchema = z.object({
    id: z.string().min(1),
});

export const createExampleSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
});

export type CreateExampleInput = z.infer<typeof createExampleSchema>;
