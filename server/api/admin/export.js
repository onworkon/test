const { query } = require('../_db');
const { requireStaff } = require('../_auth');
const { allowMethods, sendError, getQueryParam, handleApiError } = require('../_http');
const { sendCsv } = require('../_csv');
const { exportSpecs } = require('../_export_specs');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const type = getQueryParam(req, 'type') || 'users';
    const spec = exportSpecs[type];

    if (!spec) {
      sendError(res, 400, 'INVALID_EXPORT_TYPE', 'Export type is invalid');
      return;
    }

    const result = await query(spec.sql);
    sendCsv(res, spec.fileName, spec.headers, result.rows);
  } catch (error) {
    await handleApiError(res, error);
  }
};
