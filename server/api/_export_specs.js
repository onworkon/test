const exportSpecs = {
  users: {
    fileName: 'jsfes-users.csv',
    headers: [
      { key: 'uid', label: 'uid' },
      { key: 'stamp_count', label: 'stamp_count' },
      { key: 'reward_claimed', label: 'reward_claimed' },
      { key: 'reward_claimed_at', label: 'reward_claimed_at' },
      { key: 'reward_claim_method', label: 'reward_claim_method' },
      { key: 'created_at', label: 'created_at' },
      { key: 'last_active', label: 'last_active' }
    ],
    sql: `SELECT u.uid,
                 COUNT(s.id)::int AS stamp_count,
                 u.reward_claimed,
                 u.reward_claimed_at,
                 u.reward_claim_method,
                 u.created_at,
                 u.last_active
            FROM users u
            LEFT JOIN stamps s ON s.uid = u.uid
           GROUP BY u.uid
           ORDER BY u.uid`
  },
  stamps: {
    fileName: 'jsfes-stamps.csv',
    headers: [
      { key: 'uid', label: 'uid' },
      { key: 'booth_id', label: 'booth_id' },
      { key: 'booth_name', label: 'booth_name' },
      { key: 'board_slot', label: 'board_slot' },
      { key: 'stamped_at', label: 'stamped_at' }
    ],
    sql: `SELECT s.uid,
                 s.booth_id,
                 b.name AS booth_name,
                 s.board_slot,
                 s.stamped_at
            FROM stamps s
            JOIN booths b ON b.booth_id = s.booth_id
           ORDER BY s.stamped_at DESC, s.id DESC`
  },
  booths: {
    fileName: 'jsfes-booths.csv',
    headers: [
      { key: 'booth_id', label: 'booth_id' },
      { key: 'code_number', label: 'code_number' },
      { key: 'name', label: 'name' },
      { key: 'description', label: 'description' },
      { key: 'status', label: 'status' },
      { key: 'floor_label', label: 'floor_label' },
      { key: 'room_label', label: 'room_label' },
      { key: 'stamp_icon', label: 'stamp_icon' },
      { key: 'stamp_count', label: 'stamp_count' }
    ],
    sql: `SELECT b.booth_id,
                 b.code_number,
                 b.name,
                 b.description,
                 b.status,
                 b.floor_label,
                 b.room_label,
                 b.stamp_icon,
                 COUNT(s.id)::int AS stamp_count
            FROM booths b
            LEFT JOIN stamps s ON s.booth_id = b.booth_id
           GROUP BY b.booth_id
           ORDER BY b.sort_order, b.booth_id`
  },
  tags: {
    fileName: 'jsfes-tags.csv',
    headers: [
      { key: 'tag_uid', label: 'tag_uid' },
      { key: 'booth_id', label: 'booth_id' },
      { key: 'booth_name', label: 'booth_name' }
    ],
    sql: `SELECT t.tag_uid,
                 t.booth_id,
                 b.name AS booth_name
            FROM tag_maps t
            JOIN booths b ON b.booth_id = t.booth_id
           ORDER BY b.sort_order, t.tag_uid`
  },
  logs: {
    fileName: 'jsfes-operation-logs.csv',
    headers: [
      { key: 'created_at', label: 'created_at' },
      { key: 'actor_role', label: 'actor_role' },
      { key: 'actor_booth_id', label: 'actor_booth_id' },
      { key: 'action', label: 'action' },
      { key: 'target_type', label: 'target_type' },
      { key: 'target_id', label: 'target_id' },
      { key: 'metadata', label: 'metadata' }
    ],
    sql: `SELECT created_at,
                 actor_role,
                 actor_booth_id,
                 action,
                 target_type,
                 target_id,
                 metadata::text AS metadata
            FROM operation_logs
           ORDER BY created_at DESC, id DESC
           LIMIT 5000`
  }
};

module.exports = {
  exportSpecs
};
