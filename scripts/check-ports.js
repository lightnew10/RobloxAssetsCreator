// Ensure that RobloxAssetsCreator cannot silently start next to an old API/UI.
// Only tests loopback port availability; never terminates another process.
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export function checkLocalPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (error) => resolve({ port, free: false, code: error.code || 'PORT_ERROR', message: error.message }));
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve({ port, free: true }));
    });
  });
}

export async function checkDefaultPorts() {
  // A custom server port should also be checked when supplied by the shell.
  const apiPort = Number(process.env.PORT) || 3001;
  return Promise.all([checkLocalPort(apiPort), checkLocalPort(5173)]);
}

// Handle Windows file paths and POSIX paths using Node's standard filename.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() ===
    (await import('node:path')).resolve(process.argv[1]).toLowerCase()) {
  const results = await checkDefaultPorts();
  const busy = results.filter((r) => !r.free);
  for (const item of results) {
    if (item.free) console.log('[OK] Port ' + item.port + ' libre.');
    else console.error('[ERREUR] Port ' + item.port + ' occupe (' + item.code + '). Ferme les anciennes consoles RobloxAssetsCreator.');
  }
  if (busy.length) process.exitCode = 1;
}
