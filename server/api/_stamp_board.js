const STAMP_BOARD_SIZE = 9;

async function getRandomAvailableBoardSlot(db, uid) {
  const result = await db.query(
    `SELECT candidate.slot::smallint AS board_slot
       FROM generate_series(0, $2::int - 1) AS candidate(slot)
      WHERE NOT EXISTS (
        SELECT 1
          FROM stamps
         WHERE uid = $1
           AND board_slot = candidate.slot
      )
      ORDER BY RANDOM()
      LIMIT 1`,
    [uid, STAMP_BOARD_SIZE]
  );

  return result.rows[0] ? Number(result.rows[0].board_slot) : null;
}

async function insertStampInRandomSlot(db, uid, boothId) {
  const boardSlot = await getRandomAvailableBoardSlot(db, uid);
  if (boardSlot === null) return null;

  const result = await db.query(
    `INSERT INTO stamps (uid, booth_id, board_slot)
     VALUES ($1, $2, $3)
     RETURNING id, uid, booth_id, board_slot, stamped_at`,
    [uid, boothId, boardSlot]
  );

  return result.rows[0];
}

module.exports = {
  STAMP_BOARD_SIZE,
  getRandomAvailableBoardSlot,
  insertStampInRandomSlot
};
