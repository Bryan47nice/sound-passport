import type { FullConfig } from '@playwright/test';
import { createServer } from 'vite';

export default async function startViteServer(config: FullConfig) {
  const baseURL = new URL(String(config.projects[0]?.use.baseURL));
  const server = await createServer({
    server: {
      host: baseURL.hostname,
      port: Number(baseURL.port),
      strictPort: true,
    },
  });

  await server.listen();

  return async () => {
    await server.close();
  };
}
