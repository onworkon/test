import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from '../server/app.mjs';
import { openNamesStore } from '../server/names-store.mjs';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const databasePath = process.env.NAMES_DB_PATH
  ? resolve(process.env.NAMES_DB_PATH)
  : fileURLToPath(new URL('../data/visitor-names.sqlite', import.meta.url));
const port = Number(process.env.PORT || 5173);
const namesStore = openNamesStore(databasePath);
const server = createApp({ directory, namesStore });

server.listen(port, '0.0.0.0', () => {
  console.log('Local: http://localhost:' + port);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => {
    namesStore.close();
    process.exit(0);
  }));
}