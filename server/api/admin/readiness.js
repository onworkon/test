const { requireStaff } = require('../_auth');
const { getReadiness } = require('../_readiness');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    sendJson(res, 200, await getReadiness());
  } catch (error) {
    await handleApiError(res, error);
  }
};
