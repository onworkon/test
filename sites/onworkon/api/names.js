import { handleNamesRequest } from '../server/names-api.mjs';
import { openPostgresNamesStore } from '../server/postgres-names-store.mjs';

let database;
const namesStore = {
  async saveName(name, submissionId) {
    if (!process.env.DATABASE_URL) throw new Error('Name database is not configured.');
    database ??= openPostgresNamesStore(process.env.DATABASE_URL);
    return database.saveName(name, submissionId);
  },
};

export default function handler(request, response) {
  return handleNamesRequest(request, response, namesStore);
}
