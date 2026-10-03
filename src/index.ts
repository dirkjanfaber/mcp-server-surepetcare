#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadHttpConfig } from './config.js';
import { createHttpApp } from './http.js';
import { SurepetcareAPI } from './lib/surepetcare-api.js';
import { createServer } from './server.js';

const VERSION = '0.3.0';

const email = process.env.SUREPETCARE_EMAIL ?? '';
const password = process.env.SUREPETCARE_PASSWORD ?? '';
const deviceId = process.env.SUREPETCARE_DEVICE_ID ?? randomUUID();

if (!email || !password) {
  console.error('SUREPETCARE_EMAIL and SUREPETCARE_PASSWORD environment variables are required');
  process.exit(1);
}

if (!process.env.SUREPETCARE_DEVICE_ID) {
  console.error(
    'Warning: SUREPETCARE_DEVICE_ID is not set - a new random device ID will be used on every restart, ' +
    'which looks like a new device logging in each time. Set it to a stable UUID once and reuse it.'
  );
}

const api = new SurepetcareAPI({ email, password, deviceId });
const httpMode = process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http';

async function main() {
  if (httpMode) {
    const config = loadHttpConfig(process.env, homedir());
    const app = createHttpApp({
      api,
      version: VERSION,
      publicUrl: config.publicUrl,
      ownerPassword: config.ownerPassword,
      stateFile: config.stateFile,
    });
    app.listen(config.port, config.host, () => {
      console.error(`mcp-server-surepetcare ${VERSION} listening on http://${config.host}:${config.port}/mcp (public: ${new URL('/mcp', config.publicUrl)})`);
    });
    return;
  }

  const server = createServer(api, VERSION);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
