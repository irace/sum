import { createDatabase } from '@sum/db';
import { createApp } from './app.js';
import { getConfig } from './config.js';
const config = getConfig();
const database = createDatabase(config.databaseUrl);
const { app } = await createApp(database, config);
await app.listen({ host: config.production ? '0.0.0.0' : '127.0.0.1', port: config.port });
console.log(`Sum is listening on port ${config.port}`);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await database.close();
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
