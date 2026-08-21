const { requirePrize } = require('../_auth');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = requirePrize(req, res);
    if (!auth) return;

    sendJson(res, 200, {
      authenticated: true,
      role: auth.claims.role
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
