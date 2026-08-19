/* Where the server listens. Environment first, then a default that works with
   no configuration at all — this is meant to be cloned and run. */

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
};
