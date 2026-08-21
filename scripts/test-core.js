const assert = require('assert');
const { join, sep } = require('path');
const bcrypt = require('bcryptjs');

process.env.MASTER_SECRET = 'test-master-secret-at-least-32-characters';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters';

const {
  getCompositeTotpInfo,
  getReissuedCompositeTotpInfo,
  getTotpInfo,
  parseCompositeTotpCode,
  verifyTotpCode
} = require('../server/api/_totp');
const { cleanText, isValidPassword, normalizeTagUid, parseUid } = require('../server/api/_security');
const { getAllowedOrigin, getPrizePassword, getStampRequirement, positiveIntegerEnv, requiredSecret } = require('../server/api/_config');
const { escapeCsvCell, toCsv } = require('../server/api/_csv');
const { exportSpecs } = require('../server/api/_export_specs');
const { makeGlobalRateKey, makeRateKey, checkDbRateLimit } = require('../server/api/_rate_limit');
const { REWARD_CLAIM_METHODS, resolveRewardClaimMethod } = require('../server/api/_reward');
const { resolveApi, resolveStatic } = require('./local-dev');
const { bindStampImages, buildStampBoard, normalizeStampQueue, splitBoothName } = require('../public/js/common');
const {
  getPrizeCredentialVersion,
  isTokenRevoked,
  requirePrize,
  signToken,
  verifyToken
} = require('../server/api/_auth');
const { boothIdForCodeNumber, parseBoothText, planBoothIdRenames, planTagMappings } = require('./sync-booths');
const { parseManagerLoginCode, staffAccountIdForRole } = require('../server/api/_staff_credentials');
const { STAMP_BOARD_SIZE, getRandomAvailableBoardSlot, insertStampInRandomSlot } = require('../server/api/_stamp_board');
const { getUserProfile, loginUserWithProfile } = require('../server/api/_user_profile');
const { resolveRoute: resolveVercelApiRoute } = require('../api/gateway');
const { normalizedConnectionString } = require('../server/api/_db');

const now = Date.UTC(2026, 7, 3, 12, 15, 0);
assert.strictEqual(
  normalizedConnectionString('postgresql://db.test/app?sslmode=require', true),
  'postgresql://db.test/app?sslmode=verify-full'
);
assert.strictEqual(
  normalizedConnectionString('postgresql://db.test/app?sslmode=require&x=1', false),
  'postgresql://db.test/app?sslmode=no-verify&x=1'
);
assert.strictEqual(
  normalizedConnectionString('postgresql://db.test/app?sslmode=verify-ca', true),
  'postgresql://db.test/app?sslmode=verify-full'
);
const info = getTotpInfo('booth-101', now);
assert.strictEqual(info.code.length, 4);
assert.match(info.code, /^\d{4}$/);

const verified = verifyTotpCode('booth-101', info.code, now);
assert.strictEqual(verified.valid, true);
assert.strictEqual(Number.isInteger(verified.timeStep), true);
assert.strictEqual(
  verifyTotpCode('booth-101', getTotpInfo('booth-101', now - 3600000).code, now).valid,
  false
);
assert.strictEqual(
  verifyTotpCode('booth-101', getTotpInfo('booth-101', now + 3600000).code, now).valid,
  false
);
const boundary = Date.UTC(2026, 7, 3, 13, 0, 15);
const previousBoundaryCode = getTotpInfo('booth-101', boundary - 3600000).code;
assert.strictEqual(verifyTotpCode('booth-101', previousBoundaryCode, boundary).valid, true);
assert.strictEqual(
  verifyTotpCode('booth-101', previousBoundaryCode, boundary + 16000).valid,
  false
);

const invalid = verifyTotpCode('booth-102', info.code, now);
assert.strictEqual(invalid.valid, false);

const compositeInfo = getCompositeTotpInfo('booth-101', 7, now);
assert.strictEqual(compositeInfo.boothCode, '07');
assert.strictEqual(compositeInfo.entryCode, `07${info.code}`);
assert.strictEqual(compositeInfo.displayCode, `07-${info.code}`);
assert.deepStrictEqual(parseCompositeTotpCode(compositeInfo.entryCode), {
  normalized: compositeInfo.entryCode,
  codeNumber: 7,
  code: info.code
});
assert.deepStrictEqual(parseCompositeTotpCode(compositeInfo.displayCode), {
  normalized: compositeInfo.entryCode,
  codeNumber: 7,
  code: info.code
});
assert.strictEqual(parseCompositeTotpCode('004821'), null);
assert.strictEqual(parseCompositeTotpCode('12345'), null);

const reissuedInfo = getReissuedCompositeTotpInfo('booth-101', 7, 0, now);
assert.strictEqual(BigInt(reissuedInfo.generation) > 0n, true);
assert.strictEqual(reissuedInfo.boothCode, '07');
assert.strictEqual(
  verifyTotpCode('booth-101', reissuedInfo.code, now, reissuedInfo.generation).valid,
  true
);
for (const adjacentTime of [now - 3600000, now, now + 3600000]) {
  const oldCode = getTotpInfo('booth-101', adjacentTime, 0).code;
  assert.strictEqual(
    verifyTotpCode('booth-101', oldCode, now, reissuedInfo.generation).valid,
    false
  );
}
assert.throws(
  () => getTotpInfo('booth-101', now, -1),
  /non-negative integer/
);

assert.strictEqual(cleanText('  hello\u0000\nworld  ', 20), 'helloworld');
assert.strictEqual(normalizeTagUid(' AA:BB-cc '), 'aabbcc');
assert.strictEqual(parseUid('0'), 0);
assert.strictEqual(parseUid('500'), 500);
assert.strictEqual(parseUid('501'), null);
assert.strictEqual(parseUid('abc'), null);
assert.strictEqual(parseUid('12abc'), null);
assert.strictEqual(parseUid('1.5'), null);
assert.strictEqual(parseUid(' 12 '), 12);
assert.strictEqual(isValidPassword('12345678'), true);
assert.strictEqual(isValidPassword('한글암호'), false);
assert.strictEqual(isValidPassword('a'.repeat(73)), false);

assert.deepStrictEqual(splitBoothName('천체관측반(STELLA)'), {
  full: '천체관측반(STELLA)',
  front: '천체관측반',
  back: 'STELLA'
});
assert.deepStrictEqual(splitBoothName('  밴드부 ( The Stage )  '), {
  full: '밴드부 ( The Stage )',
  front: '밴드부',
  back: 'The Stage'
});
assert.deepStrictEqual(splitBoothName('학생회'), {
  full: '학생회',
  front: '학생회',
  back: '학생회'
});

assert.strictEqual(escapeCsvCell('plain'), 'plain');
assert.strictEqual(escapeCsvCell('a,b'), '"a,b"');
assert.strictEqual(escapeCsvCell('"quoted"'), '"""quoted"""');
assert.strictEqual(escapeCsvCell('=1+1'), "'=1+1");
assert.strictEqual(
  toCsv([{ key: 'name', label: 'name' }], [{ name: 'A' }]),
  'name\r\nA\r\n'
);

for (const [type, spec] of Object.entries(exportSpecs)) {
  assert.ok(type);
  assert.ok(spec.fileName.endsWith('.csv'));
  assert.ok(spec.headers.length > 0);
  assert.match(spec.sql, /^\s*SELECT/i);
}

async function testConfiguration() {
  process.env.STAMP_REQUIREMENT = '5';
  assert.strictEqual(getStampRequirement(), 9);
  delete process.env.STAMP_REQUIREMENT;
  process.env.TEST_POSITIVE_INTEGER = '12';
  assert.strictEqual(positiveIntegerEnv('TEST_POSITIVE_INTEGER', 5, 20), 12);
  process.env.TEST_POSITIVE_INTEGER = '12oops';
  assert.strictEqual(positiveIntegerEnv('TEST_POSITIVE_INTEGER', 5, 20), 5);
  process.env.TEST_SECRET = 'a'.repeat(32);
  assert.strictEqual(requiredSecret('TEST_SECRET'), 'a'.repeat(32));
  process.env.TEST_SECRET = 'too-short';
  assert.throws(() => requiredSecret('TEST_SECRET'), (error) => error.code === 'CONFIG_ERROR');
  delete process.env.TEST_POSITIVE_INTEGER;
  delete process.env.TEST_SECRET;
  process.env.ALLOWED_ORIGIN = 'https://example.com/path';
  assert.strictEqual(getAllowedOrigin(), 'https://example.com');
  process.env.ALLOWED_ORIGIN = 'javascript:alert(1)';
  assert.strictEqual(getAllowedOrigin(), null);
  delete process.env.ALLOWED_ORIGIN;
  assert.strictEqual(getAllowedOrigin(), null);
  delete process.env.PRIZE_PASSWORD;
  assert.strictEqual(getPrizePassword(), '0000');
  process.env.PRIZE_PASSWORD = '2468';
  assert.strictEqual(getPrizePassword(), '2468');
  delete process.env.PRIZE_PASSWORD;
}

async function testStampBoard() {
  assert.strictEqual(STAMP_BOARD_SIZE, 9);
  const firstStamp = { booth_id: 'booth-01', board_slot: 7, name: '첫 부스' };
  const secondStamp = { booth_id: 'booth-02', board_slot: 2, name: '둘째 부스' };
  const board = buildStampBoard([firstStamp, secondStamp], STAMP_BOARD_SIZE);
  assert.strictEqual(board.length, 9);
  assert.strictEqual(board[2], secondStamp);
  assert.strictEqual(board[7], firstStamp);
  assert.strictEqual(board.filter(Boolean).length, 2);
  assert.deepStrictEqual(buildStampBoard([{ board_slot: 12 }], 9), Array(9).fill(null));

  const slotDb = {
    async query(sql) {
      assert.match(sql, /ORDER BY RANDOM\(\)/);
      return { rows: [{ board_slot: 4 }] };
    }
  };
  assert.strictEqual(await getRandomAvailableBoardSlot(slotDb, 12), 4);

  const queries = [];
  const insertDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [{ id: 1, uid: 12, booth_id: 'booth-03', board_slot: 6 }] };
    }
  };
  const inserted = await insertStampInRandomSlot(insertDb, 12, 'booth-03');
  assert.strictEqual(inserted.board_slot, 6);
  assert.strictEqual(queries.length, 1);
  assert.match(queries[0].sql, /ORDER BY RANDOM\(\)/);
  assert.deepStrictEqual(queries[0].params, [12, 'booth-03', 9]);

  const fullBoardDb = {
    async query() {
      return { rows: [] };
    }
  };
  assert.strictEqual(await insertStampInRandomSlot(fullBoardDb, 12, 'booth-04'), null);
}

async function testUserProfile() {
  const stampRows = [
    {
      booth_id: 'booth-01',
      board_slot: 2,
      stamped_at: '2026-08-12T12:00:00.000Z',
      name: 'Test booth',
      stamp_icon: '/assets/stamps/01.webp',
      floor_label: '1F',
      room_label: '1-1'
    }
  ];
  const db = {
    async query(sql, params) {
      assert.match(sql, /FROM stamps s/);
      assert.match(sql, /ORDER BY s\.board_slot/);
      assert.deepStrictEqual(params, [12]);
      return { rows: stampRows };
    }
  };

  const profile = await getUserProfile(db, { uid: 12, reward_claimed: false });
  assert.strictEqual(profile.uid, 12);
  assert.strictEqual(profile.reward_claimed, false);
  assert.strictEqual(profile.stampRequirement, 9);
  assert.strictEqual(profile.stampCount, 1);
  assert.deepStrictEqual(profile.stamps, stampRows);

  const loginDb = {
    async query(sql, params) {
      assert.match(sql, /WITH rate_bucket AS/);
      assert.match(sql, /INSERT INTO rate_limits/);
      assert.match(sql, /updated_user AS/);
      assert.match(sql, /jsonb_agg/);
      assert.deepStrictEqual(params, [12, 'auth:user-login:12:test', 60000, 10]);
      return {
        rows: [{
          count: 1,
          reset_at: '2026-08-12T12:01:00.000Z',
          uid: 12,
          reward_claimed: true,
          stamps: stampRows
        }]
      };
    }
  };
  const loginResult = await loginUserWithProfile(loginDb, 12, {
    rateKey: 'auth:user-login:12:test',
    windowMs: 60000,
    limit: 10
  });
  assert.strictEqual(loginResult.bucket.count, 1);
  assert.strictEqual(loginResult.profile.reward_claimed, true);
  assert.strictEqual(loginResult.profile.stampCount, 1);
  assert.deepStrictEqual(loginResult.profile.stamps, stampRows);

  const missingResult = await loginUserWithProfile({
    async query() {
      return {
        rows: [{
          count: 2,
          reset_at: '2026-08-12T12:01:00.000Z',
          uid: null,
          reward_claimed: null,
          stamps: null
        }]
      };
    }
  }, 500, {
    rateKey: 'auth:user-login:500:test',
    windowMs: 60000,
    limit: 10
  });
  assert.strictEqual(missingResult.bucket.count, 2);
  assert.strictEqual(missingResult.profile, null);
}

function testRewardClaimBasis() {
  assert.strictEqual(
    resolveRewardClaimMethod(9, 9, false),
    REWARD_CLAIM_METHODS.DIGITAL_STAMPS
  );
  assert.strictEqual(
    resolveRewardClaimMethod(0, 9, true),
    REWARD_CLAIM_METHODS.OFFLINE_LEAFLET
  );
  assert.strictEqual(
    resolveRewardClaimMethod(9, 9, true),
    REWARD_CLAIM_METHODS.OFFLINE_LEAFLET
  );
  assert.strictEqual(resolveRewardClaimMethod(8, 9, false), null);
  assert.strictEqual(resolveRewardClaimMethod(8, 9, 'true'), null);
}

function testStampImageFallback() {
  function makeImage(naturalWidth) {
    const fallback = { hidden: false };
    const image = {
      complete: true,
      naturalWidth,
      removed: false,
      loaded: false,
      parentElement: {
        querySelector() { return fallback; }
      },
      classList: {
        add(value) { image.loaded = value === 'is-loaded'; }
      },
      addEventListener() {},
      remove() { image.removed = true; }
    };
    return { image, fallback };
  }

  const loaded = makeImage(128);
  bindStampImages({ querySelectorAll: () => [loaded.image] });
  assert.strictEqual(loaded.image.loaded, true);
  assert.strictEqual(loaded.image.removed, false);
  assert.strictEqual(loaded.fallback.hidden, true);

  const missing = makeImage(0);
  bindStampImages({ querySelectorAll: () => [missing.image] });
  assert.strictEqual(missing.image.removed, true);
  assert.strictEqual(missing.fallback.hidden, false);
}

async function testPasswordCompatibility() {
  const hash = await bcrypt.hash('festival-password', 4);
  assert.strictEqual(await bcrypt.compare('festival-password', hash), true);
  assert.strictEqual(await bcrypt.compare('wrong-password', hash), false);
  assert.strictEqual(bcrypt.truncates('a'.repeat(73)), true);
}

async function testRateLimit() {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' }
  };
  const key = makeRateKey(req, 'stamps:user:12');
  assert.match(key, /^stamps:user:12:[a-f0-9]{24}$/);
  assert.ok(!key.includes('203.0.113.10'));
  assert.match(makeGlobalRateKey('auth:prize-login'), /^global:[a-f0-9]{24}$/);

  const res = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
  const db = {
    async query() {
      return { rows: [{ rate_key: key, count: 11, reset_at: new Date(Date.now() + 30000) }] };
    }
  };
  assert.strictEqual(await checkDbRateLimit(req, res, 'stamps:user:12', 10, 60000, db), false);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.headers['x-ratelimit-remaining'], '0');
  assert.ok(Number(res.headers['retry-after']) >= 1);

  const allowedRes = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { this.body = value; }
  };
  const allowedDb = {
    async query() {
      return { rows: [{ rate_key: key, count: 3, reset_at: new Date(Date.now() + 30000) }] };
    }
  };
  assert.strictEqual(await checkDbRateLimit(req, allowedRes, 'stamps:user:12', 10, 60000, allowedDb), true);
  assert.strictEqual(allowedRes.headers['x-ratelimit-remaining'], '7');
}

function testLocalRouting() {
  assert.ok(resolveStatic('/css/common.css').endsWith(join('public', 'css', 'common.css')));
  assert.ok(resolveStatic('/prize').endsWith(join('public', 'prize.html')));
  assert.strictEqual(resolveStatic('/../package.json'), null);
  if (sep === '\\') assert.strictEqual(resolveStatic('/..%5cpackage.json'), null);
  assert.strictEqual(resolveStatic('/%E0%A4%A'), null);
  assert.ok(resolveApi('/api/booths/booth-101').file.endsWith('[booth_id].js'));
  assert.ok(resolveApi('/api/users/activity').file.endsWith(join('users', 'activity.js')));
  assert.ok(resolveApi('/api/auth/prize-session').file.endsWith(join('auth', 'prize-session.js')));
  assert.strictEqual(resolveApi('/api/booths/%E0%A4%A'), null);
  assert.ok(resolveVercelApiRoute('/api/ping'));
  assert.ok(resolveVercelApiRoute('/api/auth/prize-session'));
  assert.deepStrictEqual(resolveVercelApiRoute('/api/booths/booth-101').query, {
    booth_id: 'booth-101'
  });
  assert.strictEqual(resolveVercelApiRoute('/api/not-real'), null);
}

function testJwtClaims() {
  const token = signToken({ sub: 'user:12', role: 'user', uid: 12 });
  const claims = verifyToken({ headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(claims.sub, 'user:12');
  assert.strictEqual(claims.aud, 'jsfes-web');
  assert.strictEqual(claims.iss, 'jsfes-nfc');
  assert.strictEqual(claims.role, 'user');
  assert.throws(
    () => verifyToken({ headers: {} }),
    (error) => error.code === 'AUTH_REQUIRED'
  );

  assert.strictEqual(
    isTokenRevoked({ iat: 100 }, new Date(100900)),
    false
  );
  assert.strictEqual(
    isTokenRevoked({ iat: 99 }, new Date(100001)),
    true
  );

  const prizeToken = signToken(
    {
      sub: 'prize:operator',
      role: 'prize',
      credential_version: getPrizeCredentialVersion()
    },
    { expiresIn: '8h' }
  );
  const prizeResponse = {
    setHeader() {},
    end() {}
  };
  const prizeAuth = requirePrize(
    { headers: { authorization: `Bearer ${prizeToken}` } },
    prizeResponse
  );
  assert.strictEqual(prizeAuth.claims.role, 'prize');
  assert.ok(prizeAuth.claims.exp - prizeAuth.claims.iat <= 8 * 60 * 60);

  process.env.PRIZE_PASSWORD = 'changed-password';
  const revokedResponse = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.payload = payload; }
  };
  assert.strictEqual(
    requirePrize(
      { headers: { authorization: `Bearer ${prizeToken}` } },
      revokedResponse
    ),
    null
  );
  assert.strictEqual(revokedResponse.statusCode, 401);
  delete process.env.PRIZE_PASSWORD;
}

function testOfflineQueueIsolation() {
  const queue = normalizeStampQueue(JSON.stringify([
    { type: 'nfc', uid: 12, tag_uid: 'tag-a' },
    { type: 'nfc', uid: 13, tag_uid: 'tag-b' },
    { type: 'nfc', tag_uid: 'legacy-without-user' },
    { type: 'totp', uid: 12, tag_uid: 'not-queueable' }
  ]));
  assert.deepStrictEqual(queue, [
    { type: 'nfc', uid: 12, tag_uid: 'tag-a' },
    { type: 'nfc', uid: 13, tag_uid: 'tag-b' }
  ]);
  assert.deepStrictEqual(normalizeStampQueue('{bad json'), []);
  assert.deepStrictEqual(normalizeStampQueue({}), []);
}

function testBoothTextParsing() {
  const booths = parseBoothText(`1
첫 번째 부스
첫 번째 설명
1-1
0310
stamp: 01.webp

19
문학부
첫째 줄 설명
둘째 줄 설명
2-6
0518
stamp: 19.webp
tag: 04:AB-CD EF`);
  assert.deepStrictEqual(booths, [
    {
      codeNumber: 1,
      name: '첫 번째 부스',
      description: '첫 번째 설명',
      floorLabel: '',
      roomLabel: '1-1',
      managerPassword: '0310',
      stampIcon: '/assets/stamps/01.webp',
      tagUid: null,
      sortOrder: 10
    },
    {
      codeNumber: 19,
      name: '문학부',
      description: '첫째 줄 설명 둘째 줄 설명',
      floorLabel: '',
      roomLabel: '2-6',
      managerPassword: '0518',
      stampIcon: '/assets/stamps/19.webp',
      tagUid: '04abcdef',
      sortOrder: 190
    }
  ]);
  assert.strictEqual(boothIdForCodeNumber(6), 'booth-06');
  assert.deepStrictEqual(
    planBoothIdRenames(
      [{ codeNumber: 1 }, { codeNumber: 6 }],
      [
        { code_number: 1, booth_id: 'booth-101' },
        { code_number: 6, booth_id: 'booth-06' }
      ]
    ),
    [{ codeNumber: 1, oldBoothId: 'booth-101', newBoothId: 'booth-01' }]
  );
  assert.throws(
    () => planBoothIdRenames(
      [{ codeNumber: 1 }],
      [
        { code_number: 1, booth_id: 'booth-101' },
        { code_number: 2, booth_id: 'booth-01' }
      ]
    ),
    /already assigned to booth code 2/
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 01.webp\n\n1\n부스 B\n설명\n위치\n5678\nstamp: 01.webp'),
    /Duplicate booth code number/
  );
  assert.strictEqual(
    parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 01.webp\n\n2\n부스 B\n설명\n위치\n1234\nstamp: 02.webp').length,
    2
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n12345\nstamp: 01.webp'),
    /exactly four digits/
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 02.webp'),
    /stamp file must be declared as: stamp: 01.webp/
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 01.webp\ntag: 04:12:34:56\n\n2\n부스 B\n설명\n위치\n5678\nstamp: 02.webp\ntag: 04123456'),
    /Duplicate tag UID/
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 01.webp\ntag: not-a-tag'),
    /8 to 64 hexadecimal characters/
  );
  assert.throws(
    () => parseBoothText('1\n부스 A\n설명\n위치\n1234\nstamp: 01.webp\ntag:'),
    /8 to 64 hexadecimal characters/
  );
  assert.deepStrictEqual(parseManagerLoginCode('074821'), {
    normalized: '074821',
    codeNumber: 7,
    password: '4821'
  });
  assert.deepStrictEqual(parseManagerLoginCode('07-4821'), {
    normalized: '074821',
    codeNumber: 7,
    password: '4821'
  });
  assert.strictEqual(parseManagerLoginCode('004821'), null);
  assert.strictEqual(parseManagerLoginCode('07482'), null);
  assert.strictEqual(staffAccountIdForRole('admin'), 0);
  assert.strictEqual(staffAccountIdForRole('manager', 1), 1);
  assert.strictEqual(staffAccountIdForRole('manager', '20'), 20);
  assert.strictEqual(staffAccountIdForRole('manager', 0), null);
  assert.strictEqual(staffAccountIdForRole('manager', 100), null);
  assert.strictEqual(staffAccountIdForRole('user', 1), null);
}

function testTagMappingPlan() {
  const saved = [
    { code_number: 1, booth_id: 'booth-01' },
    { code_number: 2, booth_id: 'booth-02' }
  ];
  const current = [
    { booth_id: 'booth-01', tag_uid: '04111111' },
    { booth_id: 'booth-02', tag_uid: '04222222' }
  ];

  const preserved = planTagMappings(
    [
      { codeNumber: 1, tagUid: null },
      { codeNumber: 2, tagUid: '04333333' }
    ],
    saved,
    current
  );
  assert.deepStrictEqual(preserved.tagActions, ['replace']);
  assert.deepStrictEqual(Array.from(preserved.specifiedBoothIds), ['booth-02']);

  assert.throws(
    () => planTagMappings(
      [
        { codeNumber: 1, tagUid: null },
        { codeNumber: 2, tagUid: '04111111' }
      ],
      saved,
      current
    ),
    /tag was omitted/
  );

  const swapped = planTagMappings(
    [
      { codeNumber: 1, tagUid: '04222222' },
      { codeNumber: 2, tagUid: '04111111' }
    ],
    saved,
    current
  );
  assert.deepStrictEqual(swapped.tagActions, ['replace', 'replace']);
}

async function main() {
  await testConfiguration();
  await testStampBoard();
  await testUserProfile();
  testRewardClaimBasis();
  testStampImageFallback();
  await testPasswordCompatibility();
  await testRateLimit();
  testLocalRouting();
  testJwtClaims();
  testOfflineQueueIsolation();
  testBoothTextParsing();
  testTagMappingPlan();
  console.log('Core logic tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
