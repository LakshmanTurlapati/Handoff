import type { FastifyReply } from "fastify";

export interface FlyReplayInput {
  ownerMachineId: string;
  state: string;
}

export function sendFlyReplay(
  reply: FastifyReply,
  input: FlyReplayInput,
): FastifyReply {
  return reply
    .code(200)
    .type("application/vnd.fly.replay+json")
    .send({
      instance: input.ownerMachineId,
      state: input.state,
      timeout: "5s",
      fallback: "prefer_self",
    });
}
