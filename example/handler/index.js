const Url = require('url');
const Qs = require('querystring');

const fail = (ev, ctx) => err => ({
  statusCode: 500,
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    errors: [
      {
        title: err.title || err.name,
        detail: err.message,
      },
    ],
    meta: {
      id: ev.requestContext.requestId,
    },
  }),
});

const respond = (ev, ctx) => ({ statusCode, headers, rawBody: body }) => ({
  statusCode,
  headers,
  body,
});

module.exports = fn => (ev, ctx) => {
  const headers = Object.keys(ev.headers).reduce(
    (headers, name) => ({
      ...headers,
      [name.toLowerCase()]: ev.headers[name],
    }),
    {},
  );

  // NOTE: API Gateway is not setting Content-Length header on requests even when they have a body
  if (ev.body && !headers['content-length']) {
    headers['content-length'] = Buffer.byteLength(
      Buffer.from(ev.body, ev.isBase64Encoded ? 'base64' : 'utf8'),
    );
  }

  const {
    path: pathname,
    queryStringParameters: query,
    httpMethod: method,
    pathParameters: params,
  } = ev;

  const protocol = headers['x-forwarded-proto'] || 'https';
  const host = headers['host'] ? headers['host'].split(/\s*,\s*/)[0] : '';
  const origin = `${protocol}://${host}`;
  const querystring = Qs.stringify(query);
  const search = `?${querystring}`;
  const length = headers['content-length'] ? ~~headers['content-length'] : 0;

  const href = Url.format({
    protocol,
    hostname: host,
    pathname,
    query,
  });

  const request = {
    headers,
    header: (name = '') => headers[name.toLowerCase()],
    url: Url.format({ pathname, query }),
    origin,
    href,
    method,
    path: pathname,
    query,
    querystring,
    search,
    host,
  };

  const response = {
    headers: {},
    header: (name = '', value = '') => {
      response.headers[name.toLowerCase()] = value;
      return response;
    },
    statusCode: undefined,
    status: statusCode => {
      response.statusCode = statusCode;
      return response;
    },
    rawBody: '',
    body: val => {
      response.rawBody = val;
      return response;
    },
    json: (val = {}) => {
      response.rawBody = JSON.stringify(val);

      const length = Buffer.byteLength(Buffer.from(response.rawBody, 'utf8'));
      response.header('content-length', length);
      response.header('content-type', 'application/json');

      return response;
    },
  };

  return fn(request, response)
    .then(respond(ev, ctx))
    .catch(fail(ev, ctx));
};
