const { query, transaction } = require('../../_db');
const { requireStaff } = require('../../_auth');
const { logStaffAction } = require('../../_audit');
const { allowMethods, readJson, sendJson, sendError, getQueryParam, handleApiError, httpError } = require('../../_http');
const { cleanText, parseUid } = require('../../_security');
const { STAMP_BOARD_SIZE, insertStampInRandomSlot } = require('../../_stamp_board');

async function getCurrentStamps(db, uid) {
  const result = await db.query(
    `SELECT s.booth_id,
            s.board_slot,
            b.name,
            s.stamped_at
       FROM stamps s
       JOIN booths b ON b.booth_id = s.booth_id
      WHERE s.uid = $1
      ORDER BY s.board_slot`,
    [uid]
  );

  return result.rows;
}

async function getUserSnapshot(db, uid) {
  const userResult = await db.query(
    `SELECT uid, reward_claimed, reward_claimed_at, reward_claim_method, created_at, last_active
       FROM users
      WHERE uid = $1`,
    [uid]
  );

  const user = userResult.rows[0];
  if (!user) return null;

  const stamps = await getCurrentStamps(db, uid);

  return {
    ...user,
    stampCount: stamps.length,
    stamps
  };
}

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'PATCH'])) return;

  try {
    const auth = await requireStaff(req, res, ['admin']);
    if (!auth) return;

    const uid = parseUid(getQueryParam(req, 'uid'));

    if (uid === null) {
      sendError(res, 400, 'INVALID_UID', 'Invalid user ID');
      return;
    }

    if (req.method === 'GET') {
      const user = await getUserSnapshot({ query }, uid);

      if (!user) {
        sendError(res, 404, 'USER_NOT_FOUND', 'User was not found');
        return;
      }

      sendJson(res, 200, {
        user
      });
      return;
    }

    const body = await readJson(req);

    const user = await transaction(async (client) => {
      const userResult = await client.query(
        'SELECT uid, reward_claimed FROM users WHERE uid = $1 FOR UPDATE',
        [uid]
      );
      const currentUser = userResult.rows[0];
      if (!currentUser) {
        throw httpError(404, 'USER_NOT_FOUND', 'User was not found');
      }

      let changed = false;

      if (Array.isArray(body.stamps)) {
        const boothIds = [...new Set(body.stamps.map((id) => cleanText(id, 120)).filter(Boolean))];

        if (boothIds.length > STAMP_BOARD_SIZE) {
          throw httpError(400, 'BOARD_LIMIT_EXCEEDED', `A stamp board can contain at most ${STAMP_BOARD_SIZE} booths`);
        }
        if (currentUser.reward_claimed && boothIds.length > 0) {
          throw httpError(409, 'REWARD_CLAIMED', 'Reset the reward status before adding stamps');
        }

        const boothCheck = await client.query(
          'SELECT booth_id FROM booths WHERE booth_id = ANY($1::text[])',
          [boothIds]
        );
        const validBoothIds = new Set(boothCheck.rows.map((row) => row.booth_id));

        if (validBoothIds.size !== boothIds.length) {
          throw httpError(400, 'INVALID_BOOTH', 'One or more booth IDs are invalid');
        }

        await client.query('DELETE FROM stamps WHERE uid = $1', [uid]);
        changed = true;

        for (const boothId of boothIds) {
          const inserted = await insertStampInRandomSlot(client, uid, boothId);
          if (!inserted) {
            throw httpError(409, 'BOARD_COMPLETE', 'The stamp board is already complete');
          }
        }
      }

      const addBoothId = cleanText(body.add_booth_id, 120);
      if (addBoothId) {
        if (currentUser.reward_claimed) {
          throw httpError(409, 'REWARD_CLAIMED', 'Reset the reward status before adding stamps');
        }

        const booth = await client.query(
          'SELECT booth_id FROM booths WHERE booth_id = $1',
          [addBoothId]
        );

        if (!booth.rows[0]) {
          throw httpError(400, 'INVALID_BOOTH', 'Booth ID is invalid');
        }

        const existing = await client.query(
          'SELECT 1 FROM stamps WHERE uid = $1 AND booth_id = $2',
          [uid, addBoothId]
        );
        if (existing.rows[0]) {
          throw httpError(409, 'ALREADY_STAMPED', 'This booth is already stamped');
        }

        const inserted = await insertStampInRandomSlot(client, uid, addBoothId);
        if (!inserted) {
          throw httpError(409, 'BOARD_COMPLETE', 'The stamp board is already complete');
        }
        changed = true;
      }

      const removeBoothId = cleanText(body.remove_booth_id, 120);
      if (removeBoothId) {
        await client.query(
          'DELETE FROM stamps WHERE uid = $1 AND booth_id = $2',
          [uid, removeBoothId]
        );
        changed = true;
      }

      if (!changed) {
        throw httpError(400, 'NO_UPDATES', 'No stamp adjustment was provided');
      }

      await logStaffAction(
        auth.account,
        'user.stamps_adjust',
        {
          targetType: 'user',
          targetId: String(uid),
          metadata: {
            replace: Array.isArray(body.stamps),
            add_booth_id: cleanText(body.add_booth_id, 120) || null,
            remove_booth_id: cleanText(body.remove_booth_id, 120) || null
          }
        },
        client
      );

      return getUserSnapshot(client, uid);
    });

    sendJson(res, 200, {
      success: true,
      user
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
