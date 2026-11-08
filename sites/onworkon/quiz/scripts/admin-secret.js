'use strict';
const { randomBytes, scryptSync } = require('node:crypto');
const password = randomBytes(18).toString('base64url');
const salt = randomBytes(16).toString('hex');
console.log('진행자 비밀번호 (안전한 곳에 보관하고 공유/커밋하지 마세요):');
console.log(password);
console.log('\nVercel 서버 환경변수:');
console.log(`QUIZ_ADMIN_PASSWORD_HASH=scrypt$${salt}$${scryptSync(password, salt, 32).toString('hex')}`);
console.log(`QUIZ_SESSION_SECRET=${randomBytes(32).toString('hex')}`);
