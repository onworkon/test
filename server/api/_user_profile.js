const { getStampRequirement } = require('./_config');

function buildUserProfile(user, stamps) {
  return {
    uid: user.uid,
    reward_claimed: user.reward_claimed,
    stampRequirement: getStampRequirement(),
    stampCount: stamps.length,
    stamps
  };
}

async function getUserProfile(db, user) {
  const stamps = await db.query(
    `SELECT s.booth_id,
            s.board_slot,
            s.stamped_at,
            b.name,
            b.stamp_icon,
            b.floor_label,
            b.room_label
       FROM stamps s
       JOIN booths b ON b.booth_id = s.booth_id
      WHERE s.uid = $1
      ORDER BY s.board_slot`,
    [user.uid]
  );

  return buildUserProfile(user, stamps.rows);
}

async function loginUserWithProfile(db, uid, rateLimit) {
  const { rateKey, limit, windowMs } = rateLimit;
  const result = await db.query(
    `WITH rate_bucket AS (
       INSERT INTO rate_limits (rate_key, count, reset_at, updated_at)
       VALUES ($2, 1, NOW() + ($3::int * INTERVAL '1 millisecond'), NOW())
       ON CONFLICT (rate_key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.reset_at <= NOW() THEN 1
           ELSE LEAST(rate_limits.count + 1, 2147483647)
         END,
         reset_at = CASE
           WHEN rate_limits.reset_at <= NOW() THEN NOW() + ($3::int * INTERVAL '1 millisecond')
           ELSE rate_limits.reset_at
         END,
         updated_at = NOW()
       RETURNING count, reset_at
     ),
     updated_user AS (
       UPDATE users
          SET last_active = NOW()
        WHERE uid = $1
          AND (SELECT count FROM rate_bucket) <= $4
        RETURNING uid, reward_claimed
     ),
     user_profile AS (
       SELECT u.uid,
              u.reward_claimed,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'booth_id', s.booth_id,
                    'board_slot', s.board_slot,
                    'stamped_at', s.stamped_at,
                    'name', b.name,
                    'stamp_icon', b.stamp_icon,
                    'floor_label', b.floor_label,
                    'room_label', b.room_label
                  ) ORDER BY s.board_slot
                ) FILTER (WHERE s.id IS NOT NULL),
                '[]'::jsonb
              ) AS stamps
         FROM updated_user u
         LEFT JOIN stamps s ON s.uid = u.uid
         LEFT JOIN booths b ON b.booth_id = s.booth_id
        GROUP BY u.uid, u.reward_claimed
     )
     SELECT bucket.count,
            bucket.reset_at,
            profile.uid,
            profile.reward_claimed,
            profile.stamps
       FROM rate_bucket bucket
       LEFT JOIN user_profile profile ON TRUE`,
    [uid, rateKey, windowMs, limit]
  );

  const row = result.rows[0];
  const profile = row.uid === null || row.uid === undefined
    ? null
    : buildUserProfile(row, Array.isArray(row.stamps) ? row.stamps : []);

  return {
    bucket: {
      count: row.count,
      reset_at: row.reset_at
    },
    profile
  };
}

module.exports = {
  getUserProfile,
  loginUserWithProfile
};
