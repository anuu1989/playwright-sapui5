import { createServer, type Server } from 'node:http';
import { test, expect } from '../../src';
import { Ui5ODataClient } from '../../src';

/**
 * Verifies Ui5ODataClient against a real local HTTP server implementing the documented SAP
 * Gateway CSRF handshake (GET with X-CSRF-Token: Fetch -> 200 + X-CSRF-Token header; a write
 * without a valid token -> 403; a write with the token -> success). page.route() can't be used
 * here - it only intercepts requests the *browser page* makes, not Ui5ODataClient's own
 * APIRequestContext calls, which go straight from Node - so this is a real (if local, not SAP)
 * server. No real SAP Gateway was available anonymously to test against - see
 * docs/odata-client.md for exactly what this does and doesn't prove.
 */
test.describe('Ui5ODataClient', () => {
  const TOKEN = 'mock-csrf-token-abc123';
  let server: Server;
  let baseUrl: string;
  let requests: {
    method: string;
    path: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }[];
  let entity: Record<string, unknown> | undefined;

  test.beforeEach(async () => {
    requests = [];
    entity = undefined;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const path = (req.url ?? '').replace(/^\//, '');
        requests.push({ method: req.method!, path, headers: req.headers, body });

        if (req.method === 'GET' && req.headers['x-csrf-token'] === 'Fetch') {
          res.writeHead(200, { 'x-csrf-token': TOKEN });
          res.end('{}');
          return;
        }
        const isWrite = req.method === 'POST' || req.method === 'DELETE';
        if (isWrite && req.headers['x-csrf-token'] !== TOKEN) {
          res.writeHead(403, { 'x-csrf-token': 'Required' });
          res.end();
          return;
        }
        if (req.method === 'POST' && req.headers['x-http-method'] === 'MERGE') {
          entity = { ...entity, ...JSON.parse(body || '{}') };
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method === 'POST') {
          entity = JSON.parse(body || '{}');
          res.writeHead(201, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ d: entity }));
          return;
        }
        if (req.method === 'DELETE') {
          entity = undefined;
          res.writeHead(204);
          res.end();
          return;
        }
        if (req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ d: entity ?? {} }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('performs the real CSRF handshake and attaches the token to every write', async ({
    request,
  }) => {
    const client = await Ui5ODataClient.create(request, baseUrl);

    // The handshake happened exactly once, with the right header.
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    expect(requests[0].headers['x-csrf-token']).toBe('Fetch');

    // create() attaches the real token.
    const created = await client.create('Products', { ProductID: 'P1', Name: 'Widget' });
    expect(created).toEqual({ d: { ProductID: 'P1', Name: 'Widget' } });
    expect(requests[1].headers['x-csrf-token']).toBe(TOKEN);

    // update() uses POST + X-HTTP-Method: MERGE, with the token.
    await client.update("Products('P1')", { Name: 'Renamed' });
    expect(requests[2].method).toBe('POST');
    expect(requests[2].headers['x-http-method']).toBe('MERGE');
    expect(requests[2].headers['x-csrf-token']).toBe(TOKEN);

    const read = await client.read("Products('P1')");
    expect(read).toEqual({ d: { ProductID: 'P1', Name: 'Renamed' } });

    // delete() also attaches the token.
    await client.delete("Products('P1')");
    expect(requests[requests.length - 1].method).toBe('DELETE');
    expect(requests[requests.length - 1].headers['x-csrf-token']).toBe(TOKEN);

    const readAfterDelete = await client.read("Products('P1')");
    expect(readAfterDelete).toEqual({ d: {} });
  });

  test('a write without a valid token is rejected, proving the token is genuinely required', async ({
    request,
  }) => {
    // Bypass the handshake entirely and hand-craft a client with a wrong token, by going through
    // the real create() but then hitting the server directly with a bad token to confirm the
    // server (and thus the scenario the client protects against) actually enforces it.
    await Ui5ODataClient.create(request, baseUrl);
    const response = await request.post(`${baseUrl}Products`, {
      headers: { 'X-CSRF-Token': 'wrong-token' },
      data: { ProductID: 'P2' },
    });
    expect(response.status()).toBe(403);
  });

  test('create() throws a clear error when the service never returns a token', async ({
    request,
  }) => {
    const noCsrfServer = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    await new Promise<void>((resolve) => noCsrfServer.listen(0, '127.0.0.1', resolve));
    const address = noCsrfServer.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;

    await expect(Ui5ODataClient.create(request, url)).rejects.toThrow(
      /did not.*return an X-CSRF-Token header/,
    );

    await new Promise<void>((resolve) => noCsrfServer.close(() => resolve()));
  });
});
