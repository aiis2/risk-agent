import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Simple optional bearer token check; disabled if RISK_AGENT_TOKEN is empty.
 */
export function authGuard(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  const token = process.env.RISK_AGENT_TOKEN;
  if (!token) return done();
  const header = req.headers.authorization;
  if (header !== `Bearer ${token}`) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}

export function attachAuth(_app: FastifyInstance): void {
  /* placeholder for global guard registration */
}
