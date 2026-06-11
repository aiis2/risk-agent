import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodSchema } from 'zod';

/**
 * Zod validation helper middleware-ish.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
      return;
    }
    (req as any).validBody = parsed.data;
  };
}
