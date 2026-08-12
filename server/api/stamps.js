const { transaction } = require('./_db');
const { requireUser } = require('./_auth');
const { parseCompositeTotpCode, verifyTotpCode } = require('./_totp');
const {
  allowMethods,
  readJson,
  sendJson,
  sendError,
  handleApiError,
  httpError
} = require('./_http');
const { checkDbRateLimit } = require('./_rate_limit');
const { cleanText, normalizeTagUid } = require('./_security');
const { insertStampInRandomSlot } = require('./_stamp_board');

module.exports = async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;

  try {
    const auth = await requireUser(req, res);
    if (!auth) return;

    if (!(await checkDbRateLimit(req, res, `stamps:user:${auth.user.uid}`))) return;

    const body = await readJson(req);
    const type = cleanText(body.type, 20);

    if (!['nfc', 'totp'].includes(type)) {
      sendError(res, 400, 'INVALID_TYPE', 'Stamp type must be nfc or totp');
      return;
    }

    const requestedBoothId = cleanText(body.booth_id, 120);
    const tagUid = normalizeTagUid(body.tag_uid || body.serialNumber || body.uid);
    const code = cleanText(body.code, 20);
    const compositeTotp = type === 'totp' ? parseCompositeTotpCode(code) : null;

    if (type === 'nfc' && !tagUid) {
      sendError(res, 400, 'TAG_REQUIRED', 'NFC tag UID is required');
      return;
    }

    if (type === 'totp') {
      if (!compositeTotp) {
        sendError(res, 400, 'INVALID_CODE', '올바른 6자리 코드를 입력해주세요.');
        return;
      }
    }

    const booth = await transaction(async (client) => {
      const userResult = await client.query(
        'SELECT uid, reward_claimed FROM users WHERE uid = $1 FOR UPDATE',
        [auth.user.uid]
      );
      const user = userResult.rows[0];

      if (!user) {
        throw httpError(401, 'AUTH_INVALID', 'User no longer exists');
      }
      if (user.reward_claimed) {
        throw httpError(409, 'REWARD_CLAIMED', 'Reward was already claimed');
      }

      let boothId = requestedBoothId;
      let verifiedTotp = null;
      let currentBooth = null;

      if (type === 'nfc') {
        const tagResult = await client.query(
          'SELECT tag_uid, booth_id FROM tag_maps WHERE tag_uid = $1',
          [tagUid]
        );
        const tag = tagResult.rows[0];

        if (!tag) {
          throw httpError(404, 'TAG_NOT_FOUND', 'NFC tag was not registered');
        }
        if (boothId && boothId !== tag.booth_id) {
          throw httpError(400, 'TAG_BOOTH_MISMATCH', 'NFC tag does not match selected booth');
        }
        boothId = tag.booth_id;

        const boothResult = await client.query(
          'SELECT booth_id, name, status, stamp_icon FROM booths WHERE booth_id = $1 FOR UPDATE',
          [boothId]
        );
        currentBooth = boothResult.rows[0];
      } else {
        const boothResult = await client.query(
          `SELECT booth_id, name, status, stamp_icon, code_generation
             FROM booths
            WHERE code_number = $1
              FOR UPDATE`,
          [compositeTotp.codeNumber]
        );
        currentBooth = boothResult.rows[0];
        if (!currentBooth) {
          throw httpError(400, 'INVALID_CODE', '존재하지 않는 코드입니다.');
        }

        const verification = verifyTotpCode(
          currentBooth.booth_id,
          compositeTotp.code,
          Date.now(),
          currentBooth.code_generation
        );
        if (!verification.valid) {
          throw httpError(400, 'INVALID_CODE', '존재하지 않는 코드입니다.');
        }

        boothId = currentBooth.booth_id;
        verifiedTotp = { timeStep: verification.timeStep };
      }

      if (!currentBooth) {
        throw httpError(404, 'BOOTH_NOT_FOUND', 'Booth was not found');
      }
      if (currentBooth.status !== 'open') {
        throw httpError(409, 'BOOTH_CLOSED', 'Booth is not accepting stamps');
      }

      const existing = await client.query(
        'SELECT 1 FROM stamps WHERE uid = $1 AND booth_id = $2',
        [auth.user.uid, boothId]
      );
      if (existing.rows.length > 0) {
        throw httpError(409, 'ALREADY_STAMPED', 'This booth is already stamped');
      }

      if (type === 'totp') {
        try {
          await client.query(
            'INSERT INTO totp_uses (uid, booth_id, time_step) VALUES ($1, $2, $3)',
            [auth.user.uid, boothId, verifiedTotp.timeStep]
          );
        } catch (error) {
          if (error.code === '23505') {
            throw httpError(409, 'CODE_REUSED', 'This code was already used');
          }
          throw error;
        }
      }

      let savedStamp;
      try {
        savedStamp = await insertStampInRandomSlot(client, auth.user.uid, boothId);
      } catch (error) {
        if (error.code === '23505') {
          throw httpError(409, 'ALREADY_STAMPED', 'This booth is already stamped');
        }
        throw error;
      }

      if (!savedStamp) {
        throw httpError(409, 'BOARD_COMPLETE', '스탬프판이 이미 완성되었습니다.');
      }

      return {
        ...currentBooth,
        board_slot: savedStamp.board_slot
      };
    });

    sendJson(res, 200, {
      success: true,
      message: 'Stamp saved',
      booth_id: booth.booth_id,
      stamp_icon: booth.stamp_icon,
      board_slot: booth.board_slot
    });
  } catch (error) {
    handleApiError(res, error);
  }
};
