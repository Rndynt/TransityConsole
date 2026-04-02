import type { FastifyPluginAsync } from "fastify";
import * as service from "./terminals.service.js";

const terminalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/terminals/health", async () => {
    return service.getHealthSummary();
  });
};

export default terminalsRoutes;
