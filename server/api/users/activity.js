const { requireUser } = require('../_auth');
const { allowMethods, sendJson, handleApiError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const auth = await requireUser(req, res);
    if (!auth) return;

    sendJson(res, 200, {
      success: true
    });
  } catch (error) {
    await handleApiError(res, error);
  }
};
