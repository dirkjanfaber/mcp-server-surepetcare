#!/usr/bin/env node
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SurepetcareAPI } from './lib/surepetcare-api.js';
import { DeviceLockingMode, LockState } from './types/surepetcare.js';

const LOCKING_MODE_LABELS: Record<number, string> = {
  0: 'unlocked',
  1: 'locked in',
  2: 'locked out',
  3: 'locked both ways',
  4: 'curfew scheduled',
  [-1]: 'curfew locked',
  [-2]: 'curfew unlocked',
  [-3]: 'curfew unknown',
};

function lockingModeLabel(mode: DeviceLockingMode | undefined): string | undefined {
  if (mode === undefined) return undefined;
  return LOCKING_MODE_LABELS[mode] ?? `mode ${mode}`;
}

const email = process.env.SUREPETCARE_EMAIL ?? '';
const password = process.env.SUREPETCARE_PASSWORD ?? '';
const deviceId = process.env.SUREPETCARE_DEVICE_ID ?? randomUUID();

if (!email || !password) {
  console.error('SUREPETCARE_EMAIL and SUREPETCARE_PASSWORD environment variables are required');
  process.exit(1);
}

const api = new SurepetcareAPI({ email, password, deviceId });

const server = new Server(
  { name: 'mcp-server-surepetcare', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_pets',
      description: 'List all pets and their current locations (inside or outside)',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_pet_details',
      description: 'Get raw pet data including microchip tag information',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_devices',
      description: 'List all SurePetcare devices (cat flaps, feeders, etc.)',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'set_lock_state',
      description: 'Set the lock state of a SureFlap cat flap',
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: {
            type: 'string',
            description: 'Numeric device ID (from list_devices)',
          },
          lockState: {
            type: 'number',
            enum: [0, 1, 2, 3],
            description: 'Lock state: 0 = unlocked, 1 = locked-in (entry only), 2 = locked-out (exit only), 3 = locked both ways',
          },
        },
        required: ['deviceId', 'lockState'],
      },
    },
    {
      name: 'rename_device',
      description: "Rename a SurePetcare device (e.g. a cat flap). Automatically re-asserts any explicit lock override (0-3) that was active beforehand, since the underlying rename endpoint has been observed to silently reset it to unlocked otherwise.",
      inputSchema: {
        type: 'object',
        properties: {
          deviceId: {
            type: 'string',
            description: 'Numeric device ID (from list_devices)',
          },
          name: {
            type: 'string',
            description: 'New name for the device',
          },
        },
        required: ['deviceId', 'name'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_pets': {
      const pets = await api.getPets();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(pets.map(pet => ({
            id: pet.id,
            name: pet.name,
            location: pet.position.where === 1 ? 'inside' : 'outside',
            since: pet.position.since,
          })), null, 2),
        }],
      };
    }

    case 'get_pet_details': {
      const raw = await api.getPetsRaw();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(raw, null, 2),
        }],
      };
    }

    case 'list_devices': {
      const devices = await api.getDevices();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(devices.map(d => ({
            id: d.id,
            name: d.name,
            serial_number: d.serial_number,
            product_id: d.product_id,
            lockingMode: d.status?.locking?.mode,
            lockingModeLabel: lockingModeLabel(d.status?.locking?.mode),
            curfew: d.control?.curfew,
          })), null, 2),
        }],
      };
    }

    case 'set_lock_state': {
      const deviceId = args?.deviceId as string;
      const lockState = args?.lockState as LockState;
      if (!deviceId || lockState === undefined) {
        throw new Error('deviceId and lockState are required');
      }
      await api.setLockState(deviceId, lockState);
      return {
        content: [{
          type: 'text',
          text: `Lock state of device ${deviceId} set to ${lockState}`,
        }],
      };
    }

    case 'rename_device': {
      const deviceId = args?.deviceId as string;
      const name = args?.name as string;
      if (!deviceId || !name) {
        throw new Error('deviceId and name are required');
      }
      await api.renameDevice(deviceId, name);
      return {
        content: [{
          type: 'text',
          text: `Device ${deviceId} renamed to "${name}"`,
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
