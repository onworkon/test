DELETE FROM totp_uses
 WHERE uid = 0;

DELETE FROM stamps
 WHERE uid = 0;

UPDATE users
   SET reward_claimed = FALSE,
       reward_claimed_at = NULL
 WHERE uid = 0;
