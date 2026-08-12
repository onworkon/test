ALTER TABLE stamps
  ADD COLUMN IF NOT EXISTS board_slot SMALLINT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM stamps
     GROUP BY uid
    HAVING COUNT(*) > 9
  ) THEN
    RAISE EXCEPTION 'A user has more than 9 stamps; resolve this before adding fixed board slots';
  END IF;
END
$$;

WITH stamp_ranks AS (
  SELECT id,
         uid,
         ROW_NUMBER() OVER (PARTITION BY uid ORDER BY RANDOM())::int AS stamp_rank
    FROM stamps
   WHERE board_slot IS NULL
),
user_slots AS (
  SELECT stamped_user.uid,
         ARRAY_AGG(slot_number ORDER BY RANDOM()) AS slots
    FROM (SELECT DISTINCT uid FROM stamps WHERE board_slot IS NULL) AS stamped_user
    CROSS JOIN GENERATE_SERIES(0, 8) AS slot_number
   GROUP BY stamped_user.uid
)
UPDATE stamps AS stamp
   SET board_slot = user_slots.slots[stamp_ranks.stamp_rank]::smallint
  FROM stamp_ranks
  JOIN user_slots ON user_slots.uid = stamp_ranks.uid
 WHERE stamp.id = stamp_ranks.id;

ALTER TABLE stamps
  ALTER COLUMN board_slot SET NOT NULL;

ALTER TABLE stamps
  ADD CONSTRAINT stamps_board_slot_range_check
  CHECK (board_slot BETWEEN 0 AND 8);

ALTER TABLE stamps
  ADD CONSTRAINT stamps_uid_board_slot_unique
  UNIQUE (uid, board_slot);
