const { query } = require('./_db');

function safeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return {};
  return metadata;
}

async function logStaffAction(account, action, options = {}, db = { query }) {
  if (!account || !action) return;

  await db.query(
    `INSERT INTO operation_logs (
       staff_account_id,
       actor_role,
       actor_booth_id,
       action,
       target_type,
       target_id,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      account.id,
      account.role,
      account.booth_id || null,
      action,
      options.targetType || null,
      options.targetId || null,
      JSON.stringify(safeMetadata(options.metadata))
    ]
  );
}

module.exports = {
  logStaffAction
};
