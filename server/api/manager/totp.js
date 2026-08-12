const { query, transaction } = require('../_db');
const { requireStaff } = require('../_auth');
const { logStaffAction } = require('../_audit');
const { checkDbRateLimit } = require('../_rate_limit');
const { getCompositeTotpInfo, getReissuedCompositeTotpInfo } = require('../_totp');
const { allowMethods, sendJson, handleApiError, httpError } = require('../_http');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;

  try {
    const auth = await requireStaff(req, res, ['manager']);
    if (!auth) return;

    let totp;

    if (req.method === 'POST') {
      const rateLimitKey = `manager:totp:reissue:${auth.account.id}`;
      if (!(await checkDbRateLimit(req, res, rateLimitKey, 10, 60000))) return;

      const nowMs = Date.now();
      totp = await transaction(async (client) => {
        const boothResult = await client.query(
          `SELECT code_number, code_generation
             FROM booths
            WHERE booth_id = $1
              FOR UPDATE`,
          [auth.account.booth_id]
        );
        const booth = boothResult.rows[0];
        if (!booth) {
          throw httpError(404, 'BOOTH_NOT_FOUND', 'Booth was not found');
        }

        const reissued = getReissuedCompositeTotpInfo(
          auth.account.booth_id,
          booth.code_number,
          booth.code_generation,
          nowMs
        );

        await client.query(
          `UPDATE booths
              SET code_generation = $2,
                  updated_at = NOW()
            WHERE booth_id = $1`,
          [auth.account.booth_id, reissued.generation]
        );

        await logStaffAction(
          auth.account,
          'booth.code_reissue',
          {
            targetType: 'booth',
            targetId: auth.account.booth_id,
            metadata: {
              previousGeneration: String(booth.code_generation),
              codeGeneration: reissued.generation
            }
          },
          client
        );

        return reissued;
      });
    } else {
      const boothResult = await query(
        'SELECT code_number, code_generation FROM booths WHERE booth_id = $1',
        [auth.account.booth_id]
      );
      const booth = boothResult.rows[0];
      if (!booth) {
        throw httpError(404, 'BOOTH_NOT_FOUND', 'Booth was not found');
      }

      totp = getCompositeTotpInfo(
        auth.account.booth_id,
        booth.code_number,
        Date.now(),
        booth.code_generation
      );
    }

    sendJson(res, 200, {
      booth_id: auth.account.booth_id,
      totp
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
