'use strict';

// All event operations are serialized by Redis, across every Vercel instance.
// No response data is stored in process memory or on the local filesystem.
const EVENT_SCRIPT = `
local op, fingerprint, total = ARGV[1], ARGV[2], tonumber(ARGV[3])
local pid, question, choice, correct = ARGV[4], tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local function err(code) return cjson.encode({error=code}) end
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('HSET', KEYS[1], 'status', 'waiting', 'fingerprint', fingerprint, 'completed', 0)
end
if redis.call('HGET', KEYS[1], 'fingerprint') ~= fingerprint then return err('CONTENT_CHANGED') end
local status = redis.call('HGET', KEYS[1], 'status')
if op == 'public' then return cjson.encode({status=status}) end
if op == 'start' then
  if status == 'ended' then return err('ENDED') end
  redis.call('HSET', KEYS[1], 'status', 'running')
  return cjson.encode({status='running'})
end
if op == 'end' then
  redis.call('HSET', KEYS[1], 'status', 'ended')
  return cjson.encode({status='ended'})
end
if op == 'stats' then
  local rows = {}
  local submitted, right = 0, 0
  for i=1,total do
    local n = tonumber(redis.call('HGET', KEYS[4], 'submitted:'..i) or '0')
    local c = tonumber(redis.call('HGET', KEYS[4], 'correct:'..i) or '0')
    rows[i] = {id=i, submitted=n, correct=c}
    submitted, right = submitted+n, right+c
  end
  redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now-45000)
  return cjson.encode({status=status, participants=redis.call('HLEN', KEYS[2]),
    online=redis.call('ZCARD', KEYS[3]), completed=tonumber(redis.call('HGET', KEYS[1], 'completed')),
    questions=rows, overall={submitted=submitted, correct=right}})
end
local raw = redis.call('HGET', KEYS[2], pid)
if not raw then
  if op ~= 'session' then return err('UNKNOWN_PARTICIPANT') end
  if status ~= 'waiting' then return err('ADMISSION_CLOSED') end
  raw = cjson.encode({next=1, answers={}})
  redis.call('HSET', KEYS[2], pid, raw)
end
local participant = cjson.decode(raw)
if op == 'answer' then
  -- Check event status BEFORE idempotency: even retries are rejected after end.
  if status == 'ended' then return err('ENDED') end
  if status ~= 'running' then return err('NOT_STARTED') end
  if not question or question < 1 or question > total or question ~= math.floor(question) or
    not choice or choice < 1 or choice > 4 or choice ~= math.floor(choice) then return err('INVALID_ANSWER') end
  local previous = participant.answers[tostring(question)]
  if previous then
    if previous ~= choice then return err('ANSWER_LOCKED') end
    -- A retry of the exact same answer succeeds without changing any counters.
  elseif question ~= participant.next then
    return err('OUT_OF_ORDER')
  else
    participant.answers[tostring(question)] = choice
    participant.next = participant.next + 1
    redis.call('HSET', KEYS[2], pid, cjson.encode(participant))
    redis.call('HINCRBY', KEYS[4], 'submitted:'..question, 1)
    if choice == correct then redis.call('HINCRBY', KEYS[4], 'correct:'..question, 1) end
    if participant.next == total+1 then redis.call('HINCRBY', KEYS[1], 'completed', 1) end
  end
end
redis.call('ZADD', KEYS[3], now, pid)
return cjson.encode({status=status, submitted=participant.next-1})
`;

const LIMIT_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], 600) end
return n
`;

function createRestCommand(config) {
  return async (command) => {
    const response = await fetch(config.redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.redisToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('QUIZ_STORAGE_UNAVAILABLE');
    const data = await response.json();
    if (data.error || !Object.hasOwn(data, 'result')) throw new Error('QUIZ_STORAGE_UNAVAILABLE');
    return data.result;
  };
}

function createStore(config, command = createRestCommand(config)) {
  const prefix = `quiz:{${config.eventId}}`;
  const keys = ['event', 'participants', 'presence', 'stats'].map((name) => `${prefix}:${name}`);
  return {
    async run(op, participant = '', question = 0, choice = 0, correct = 0) {
      const result = await command(['EVAL', EVENT_SCRIPT, keys.length, ...keys,
        op, config.fingerprint, config.total, participant, question, choice, correct]);
      return typeof result === 'string' ? JSON.parse(result) : result;
    },
    async allowLogin(ipHash) {
      const perIp = await command(['EVAL', LIMIT_SCRIPT, 1, `${prefix}:login:${ipHash}`]);
      if (perIp > 10) return false;
      const all = await command(['EVAL', LIMIT_SCRIPT, 1, `${prefix}:login:all`]);
      return all <= 100;
    }
  };
}

module.exports = { createStore, createRestCommand, EVENT_SCRIPT, LIMIT_SCRIPT };
