#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SurepetcareAPI } from './lib/surepetcare-api.js';
import { createServer } from './server.js';

const VERSION = '0.2.0';

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
const server = createServer(api, VERSION);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
