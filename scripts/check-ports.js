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

export function projectPorts(customPort = process.env.PORT) {
  // 5174 was previously used when Vite silently selected a fallback port.
  const value = Number(customPort);
  const extraPort = Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
  return [...new Set([3001, 5173, 5174, ...(extraPort ? [extraPort] : [])])];
}

export async function checkDefaultPorts() {
  return Promise.all(projectPorts().map((port) => checkLocalPort(port)));
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
