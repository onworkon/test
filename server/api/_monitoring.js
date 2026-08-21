let sentry = null;
let initialized = false;

function getSentry() {
  if (initialized) return sentry;
  initialized = true;

  if (!process.env.SENTRY_DSN) {
    return null;
  }

  sentry = require('@sentry/node');
  sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0
  });

  return sentry;
}

function captureException(error, context = {}) {
  const client = getSentry();
  if (!client) return;

  client.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      scope.setExtra(key, value);
    }
    client.captureException(error);
  });
}

async function flushMonitoring(timeoutMs = 1500) {
  const client = getSentry();
  if (!client) return true;
  try {
    return await client.flush(timeoutMs);
  } catch (error) {
    console.error('Sentry flush failed', error);
    return false;
  }
}

module.exports = {
  captureException,
  flushMonitoring
};
