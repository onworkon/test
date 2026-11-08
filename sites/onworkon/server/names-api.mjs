function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

export async function handleNamesRequest(request, response, namesStore) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  const origin = request.headers.origin;
  if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== 'http://' + request.headers.host && origin !== 'https://' + request.headers.host)) {
    json(response, 403, { error: 'Cross-origin requests are not allowed.' });
    return;
  }
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) {
    json(response, 415, { error: 'JSON is required.' });
    return;
  }
  if (Number(request.headers['content-length']) > 4096) {
    json(response, 413, { error: 'Request is too large.' });
    return;
  }

  try {
    let data;
    if (request.body !== undefined) {
      // Vercel parses JSON bodies before calling a Node.js function.
      const body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      if (Buffer.byteLength(body) > 4096) {
        json(response, 413, { error: 'Request is too large.' });
        return;
      }
      data = JSON.parse(body);
    } else {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) {
          json(response, 413, { error: 'Request is too large.' });
          return;
        }
        chunks.push(chunk);
      }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const result = await namesStore.saveName(data?.name, data?.submissionId);
    json(response, result.created ? 201 : 200, result);
  } catch (error) {
    if (error instanceof SyntaxError || error.status === 400) json(response, 400, { error: 'Invalid name or request.' });
    else if (error.status === 409) json(response, 409, { error: 'Submission conflict.' });
    else {
      console.error('Name storage failed:', error.code || error.name);
      json(response, 503, { error: 'Storage is unavailable. Please retry.' });
    }
  }
}
