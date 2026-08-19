/* Response helpers.
 *
 * Every reply this server sends goes through one of these, so that headers we
 * always want — content type, length, the Allow list on a 405 — are written in
 * one place rather than remembered at each call site. */

export function send(res, status, body, headers = {}){
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(status, { 'Content-Length': payload.length, ...headers });
  res.end(res.req?.method === 'HEAD' ? undefined : payload);
}

export const html = (res, body, status = 200) =>
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8' });

export const json = (res, value, status = 200) =>
  send(res, status, JSON.stringify(value), { 'Content-Type': 'application/json; charset=utf-8' });

export const text = (res, body, status = 200, headers = {}) =>
  send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });

export const notFound = res => text(res, 'Not Found', 404);

export const methodNotAllowed = res => text(res, 'Method Not Allowed', 405, { Allow: 'GET, HEAD' });

export const redirect = (res, location) => {
  res.writeHead(302, { Location: location, 'Content-Length': 0 });
  res.end();
};
