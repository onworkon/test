const { allowMethods, sendJson } = require('./_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  sendJson(res, 200, {
    success: true,
    now: new Date().toISOString()
  });
};
