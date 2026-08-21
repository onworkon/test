const { query } = require('../_db');
const { requireUser } = require('../_auth');
const { getUserProfile } = require('../_user_profile');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireUser(req, res);
    if (!auth) return;

    sendJson(res, 200, await getUserProfile({ query }, auth.user));
  } catch (error) {
    await handleApiError(res, error);
  }
};
