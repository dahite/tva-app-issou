import { Container, getContainer } from "@cloudflare/containers";

export class TvaContainer extends Container {
  defaultPort = 3000;
  sleepAfter = "10m";

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { GEMINI_API_KEY: env.GEMINI_API_KEY };
  }
}

export default {
  async fetch(request, env) {
    return getContainer(env.TVA_CONTAINER).fetch(request);
  },
};
