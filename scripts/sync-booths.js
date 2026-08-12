const { existsSync, readFileSync } = require('fs');
const { join, resolve } = require('path');
const bcrypt = require('bcryptjs');
const { loadEnv } = require('./_env');
const { createPool } = require('./_db');
const { normalizeTagUid } = require('../server/api/_security');

const projectRoot = join(__dirname, '..');
const defaultInputPath = join(projectRoot, '..', 'booth.txt');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    file: defaultInputPath
  };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (value === '--file' && argv[index + 1]) {
      args.file = resolve(projectRoot, argv[index + 1]);
      index += 1;
    }
  }

  return args;
}

function deriveFloorLabel(location) {
  const match = String(location || '').match(/(\d+)\s*층/);
  return match ? `${match[1]}층` : '';
}

function parseBoothText(raw) {
  const blocks = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    throw new Error('booth.txt does not contain any booth records');
  }

  const seenCodeNumbers = new Set();
  const seenTagUids = new Set();

  return blocks.map((block, index) => {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 6) {
      throw new Error(`Booth block ${index + 1} must contain a number, name, description, location, four-digit password, and stamp file`);
    }

    if (!/^\d{1,2}$/.test(lines[0])) {
      throw new Error(`Booth block ${index + 1} has an invalid code number: ${lines[0]}`);
    }

    const tagDeclaration = lines[lines.length - 1].match(/^tag:\s*(.*)$/i);
    const stampLineIndex = tagDeclaration ? lines.length - 2 : lines.length - 1;
    const codeNumber = Number(lines[0]);
    const name = lines[1];
    const description = lines.slice(2, stampLineIndex - 2).join(' ');
    const roomLabel = lines[stampLineIndex - 2];
    const managerPassword = lines[stampLineIndex - 1];
    const stampMatch = lines[stampLineIndex]?.match(/^stamp:\s*(\d{2}\.webp)$/i);
    const tagUid = tagDeclaration ? normalizeTagUid(tagDeclaration[1]) : null;

    if (codeNumber < 1 || codeNumber > 99) {
      throw new Error(`Booth code number must be between 1 and 99: ${codeNumber}`);
    }
    if (seenCodeNumbers.has(codeNumber)) {
      throw new Error(`Duplicate booth code number: ${codeNumber}`);
    }
    if (!name || name.length > 120) {
      throw new Error(`Booth ${codeNumber} name must be between 1 and 120 characters`);
    }
    if (!description || description.length > 1000) {
      throw new Error(`Booth ${codeNumber} description must be between 1 and 1000 characters`);
    }
    if (!roomLabel || roomLabel.length > 120) {
      throw new Error(`Booth ${codeNumber} location must be between 1 and 120 characters`);
    }
    if (!/^\d{4}$/.test(managerPassword)) {
      throw new Error(`Booth ${codeNumber} manager password must contain exactly four digits`);
    }
    const expectedStampFile = `${String(codeNumber).padStart(2, '0')}.webp`;
    if (!stampMatch || stampMatch[1].toLowerCase() !== expectedStampFile) {
      throw new Error(`Booth ${codeNumber} stamp file must be declared as: stamp: ${expectedStampFile}`);
    }
    if (tagDeclaration && !/^[0-9a-f]{8,64}$/.test(tagUid)) {
      throw new Error(`Booth ${codeNumber} tag UID must contain 8 to 64 hexadecimal characters`);
    }
    if (tagUid && seenTagUids.has(tagUid)) {
      throw new Error(`Duplicate tag UID in booth.txt: booth ${codeNumber}`);
    }

    seenCodeNumbers.add(codeNumber);
    if (tagUid) seenTagUids.add(tagUid);
    return {
      codeNumber,
      name,
      description,
      floorLabel: deriveFloorLabel(roomLabel),
      roomLabel,
      managerPassword,
      stampIcon: `/assets/stamps/${expectedStampFile}`,
      tagUid,
      sortOrder: codeNumber * 10
    };
  });
}

function boothIdForCodeNumber(codeNumber) {
  return `booth-${String(codeNumber).padStart(2, '0')}`;
}

function planBoothIdRenames(records, existingRows) {
  const existingByCode = new Map(
    existingRows.map((row) => [Number(row.code_number), row])
  );
  const existingById = new Map(
    existingRows.map((row) => [row.booth_id, row])
  );

  return records.flatMap((record) => {
    const existing = existingByCode.get(record.codeNumber);
    if (!existing) return [];

    const canonicalBoothId = boothIdForCodeNumber(record.codeNumber);
    if (existing.booth_id === canonicalBoothId) return [];

    const collision = existingById.get(canonicalBoothId);
    if (collision && Number(collision.code_number) !== record.codeNumber) {
      throw new Error(
        `Canonical booth ID ${canonicalBoothId} is already assigned to booth code ${collision.code_number}`
      );
    }

    return [{
      codeNumber: record.codeNumber,
      oldBoothId: existing.booth_id,
      newBoothId: canonicalBoothId
    }];
  });
}

function planTagMappings(records, saved, currentMappings) {
  const savedByCode = new Map(
    saved.map((row) => [Number(row.code_number), row])
  );
  const tagOwnerByUid = new Map(
    currentMappings.map((row) => [row.tag_uid, row.booth_id])
  );
  const tagUidsByBooth = new Map();
  for (const row of currentMappings) {
    const boothTags = tagUidsByBooth.get(row.booth_id) || [];
    boothTags.push(row.tag_uid);
    tagUidsByBooth.set(row.booth_id, boothTags);
  }

  const desiredTags = records
    .filter((record) => record.tagUid)
    .map((record) => ({
      boothId: savedByCode.get(record.codeNumber).booth_id,
      tagUid: record.tagUid
    }));
  const specifiedBoothIds = new Set(desiredTags.map((item) => item.boothId));

  for (const item of desiredTags) {
    const currentOwner = tagOwnerByUid.get(item.tagUid);
    if (currentOwner && currentOwner !== item.boothId && !specifiedBoothIds.has(currentOwner)) {
      throw new Error(
        'A declared tag UID is already assigned to a booth whose tag was omitted; no changes were applied'
      );
    }
  }

  const tagActions = desiredTags.map((item) => {
    const currentTags = tagUidsByBooth.get(item.boothId) || [];
    if (currentTags.length === 0) return 'insert';
    if (currentTags.length === 1 && currentTags[0] === item.tagUid) return 'unchanged';
    return 'replace';
  });

  return {
    desiredTags,
    specifiedBoothIds,
    tagActions
  };
}

async function syncBooths(pool, records, options = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jsfes:booth-sync'))");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('jsfes:tag-maps'))");

    let existingResult = await client.query(
      `SELECT booth_id, code_number, name
         FROM booths
        ORDER BY code_number`
    );
    const boothIdRenames = planBoothIdRenames(records, existingResult.rows);

    for (const rename of boothIdRenames) {
      await client.query(
        `UPDATE booths
            SET booth_id = $1,
                updated_at = NOW()
          WHERE booth_id = $2`,
        [rename.newBoothId, rename.oldBoothId]
      );
      await client.query(
        `UPDATE operation_logs
            SET actor_booth_id = $1
          WHERE actor_booth_id = $2`,
        [rename.newBoothId, rename.oldBoothId]
      );
      await client.query(
        `UPDATE operation_logs
            SET target_id = $1
          WHERE target_type = 'booth'
            AND target_id = $2`,
        [rename.newBoothId, rename.oldBoothId]
      );
      await client.query(
        `UPDATE staff_accounts
            SET token_revoked_at = NOW(),
                updated_at = NOW()
          WHERE role = 'manager'
            AND booth_id = $1`,
        [rename.newBoothId]
      );
    }

    if (boothIdRenames.length > 0) {
      existingResult = await client.query(
        `SELECT booth_id, code_number, name
           FROM booths
          ORDER BY code_number`
      );
    }
    const existingByCode = new Map(
      existingResult.rows.map((row) => [Number(row.code_number), row])
    );
    const managerResult = await client.query(
      `SELECT id, booth_id, password_hash
         FROM staff_accounts
        WHERE role = 'manager'
        FOR UPDATE`
    );
    const managersByBooth = new Map(
      managerResult.rows.map((row) => [row.booth_id, row])
    );
    const tagResult = await client.query(
      `SELECT tag_uid, booth_id
         FROM tag_maps
        FOR UPDATE`
    );
    const inputCodes = new Set(records.map((record) => record.codeNumber));
    const unlisted = existingResult.rows.filter((row) => !inputCodes.has(Number(row.code_number)));
    const saved = [];
    const managerAccounts = [];

    for (const record of records) {
      const existing = existingByCode.get(record.codeNumber);
      const boothId = boothIdForCodeNumber(record.codeNumber);
      const result = await client.query(
        `INSERT INTO booths (
           booth_id,
           code_number,
           name,
           description,
           stamp_icon,
           floor_label,
           room_label,
           sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (code_number) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           stamp_icon = EXCLUDED.stamp_icon,
           floor_label = EXCLUDED.floor_label,
           room_label = EXCLUDED.room_label,
           sort_order = EXCLUDED.sort_order,
           updated_at = NOW()
         RETURNING booth_id, code_number, name, description, stamp_icon, floor_label, room_label, sort_order, status`,
        [
          boothId,
          record.codeNumber,
          record.name,
          record.description,
          record.stampIcon,
          record.floorLabel,
          record.roomLabel,
          record.sortOrder
        ]
      );

      saved.push({
        action: existing ? 'update' : 'insert',
        ...result.rows[0]
      });

      const existingManager = managersByBooth.get(boothId);

      if (existingManager && await bcrypt.compare(record.managerPassword, existingManager.password_hash)) {
        managerAccounts.push({ booth_id: boothId, action: 'unchanged' });
        continue;
      }

      const passwordHash = await bcrypt.hash(record.managerPassword, 10);

      if (existingManager) {
        await client.query(
          `UPDATE staff_accounts
              SET password_hash = $1,
                  token_revoked_at = NOW(),
                  updated_at = NOW()
            WHERE id = $2`,
          [passwordHash, existingManager.id]
        );
        managerAccounts.push({ booth_id: boothId, action: 'update' });
      } else {
        await client.query(
          `INSERT INTO staff_accounts (role, booth_id, password_hash)
           VALUES ('manager', $1, $2)`,
          [boothId, passwordHash]
        );
        managerAccounts.push({ booth_id: boothId, action: 'insert' });
      }
    }

    const { desiredTags, specifiedBoothIds, tagActions } = planTagMappings(
      records,
      saved,
      tagResult.rows
    );

    if (desiredTags.length > 0) {
      await client.query(
        'DELETE FROM tag_maps WHERE booth_id = ANY($1::text[])',
        [Array.from(specifiedBoothIds)]
      );
      for (const item of desiredTags) {
        await client.query(
          'INSERT INTO tag_maps (tag_uid, booth_id) VALUES ($1, $2)',
          [item.tagUid, item.boothId]
        );
      }
    }

    if (options.dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');

    return {
      dryRun: Boolean(options.dryRun),
      inputCount: records.length,
      renamedCount: boothIdRenames.length,
      renamedBooths: boothIdRenames,
      insertedCount: saved.filter((row) => row.action === 'insert').length,
      updatedCount: saved.filter((row) => row.action === 'update').length,
      managerAccounts: {
        insertedCount: managerAccounts.filter((row) => row.action === 'insert').length,
        updatedCount: managerAccounts.filter((row) => row.action === 'update').length,
        unchangedCount: managerAccounts.filter((row) => row.action === 'unchanged').length
      },
      tagMappings: {
        specifiedCount: desiredTags.length,
        insertedCount: tagActions.filter((action) => action === 'insert').length,
        replacedCount: tagActions.filter((action) => action === 'replace').length,
        unchangedCount: tagActions.filter((action) => action === 'unchanged').length,
        preservedBoothCount: records.length - desiredTags.length
      },
      unlisted: unlisted.map((row) => ({
        booth_id: row.booth_id,
        code_number: Number(row.code_number),
        name: row.name
      })),
      booths: saved
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!existsSync(args.file)) {
    throw new Error(`Booth data file was not found: ${args.file}`);
  }

  loadEnv(projectRoot);
  const records = parseBoothText(readFileSync(args.file, 'utf8'));
  const pool = createPool();

  try {
    const result = await syncBooths(pool, records, { dryRun: args.dryRun });
    console.log(JSON.stringify({ inputFile: args.file, ...result }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  boothIdForCodeNumber,
  deriveFloorLabel,
  parseBoothText,
  planBoothIdRenames,
  planTagMappings,
  syncBooths
};
