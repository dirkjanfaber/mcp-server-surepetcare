import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DeviceLockingMode, SurepetcareBackend } from './types/surepetcare.js';

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

function parseArgs<T extends z.ZodTypeAny>(schema: T, args: unknown): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    throw new Error(`Invalid arguments: ${issues}`);
  }
  return result.data;
}

const DeviceIdSchema = z.string().min(1, 'required');

const SetLockStateArgs = z.object({
  deviceId: DeviceIdSchema,
  lockState: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

const RenameDeviceArgs = z.object({
  deviceId: DeviceIdSchema,
  name: z.string().min(1, 'required'),
});

const SetPetLocationArgs = z.object({
  petId: z.string().min(1, 'required'),
  location: z.enum(['inside', 'outside']),
});

const SetLedModeArgs = z.object({
  deviceId: DeviceIdSchema,
  mode: z.union([z.literal(0), z.literal(1), z.literal(4)]),
});

export const TOOLS = [
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
    description: 'List all SurePetcare devices, including live lock state and curfew schedule',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'set_lock_state',
    description: 'Set the lock state of a SureFlap cat flap',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Numeric device ID (from list_devices)' },
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
        deviceId: { type: 'string', description: 'Numeric device ID (from list_devices)' },
        name: { type: 'string', description: 'New name for the device' },
      },
      required: ['deviceId', 'name'],
    },
  },
  {
    name: 'set_pet_location',
    description: "Manually mark a pet as inside or outside. Useful when a pet was let through a door other than the flap, so its chip was never read and the app's tracked location is stale.",
    inputSchema: {
      type: 'object',
      properties: {
        petId: { type: 'string', description: 'Numeric pet ID (from list_pets)' },
        location: { type: 'string', enum: ['inside', 'outside'], description: 'Where the pet actually is' },
      },
      required: ['petId', 'location'],
    },
  },
  {
    name: 'set_led_mode',
    description: "Set the hub's LED ring brightness",
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'Numeric device ID of the hub (from list_devices)' },
        mode: { type: 'number', enum: [0, 1, 4], description: 'LED mode: 0 = off, 1 = bright, 4 = dimmed' },
      },
      required: ['deviceId', 'mode'],
    },
  },
] as const;

export async function handleToolCall(name: string, args: unknown, api: SurepetcareBackend) {
  switch (name) {
    case 'list_pets': {
      const pets = await api.getPets();
      return {
        content: [{
          type: 'text' as const,
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
      return { content: [{ type: 'text' as const, text: JSON.stringify(raw, null, 2) }] };
    }

    case 'list_devices': {
      const devices = await api.getDevices();
      return {
        content: [{
          type: 'text' as const,
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
      const { deviceId, lockState } = parseArgs(SetLockStateArgs, args);
      await api.setLockState(deviceId, lockState);
      return { content: [{ type: 'text' as const, text: `Lock state of device ${deviceId} set to ${lockState}` }] };
    }

    case 'rename_device': {
      const { deviceId, name: newName } = parseArgs(RenameDeviceArgs, args);
      await api.renameDevice(deviceId, newName);
      return { content: [{ type: 'text' as const, text: `Device ${deviceId} renamed to "${newName}"` }] };
    }

    case 'set_pet_location': {
      const { petId, location } = parseArgs(SetPetLocationArgs, args);
      await api.setPetLocation(petId, location === 'inside' ? 1 : 2);
      return { content: [{ type: 'text' as const, text: `Pet ${petId} marked as ${location}` }] };
    }

    case 'set_led_mode': {
      const { deviceId, mode } = parseArgs(SetLedModeArgs, args);
      await api.setLedMode(deviceId, mode);
      return { content: [{ type: 'text' as const, text: `LED mode of device ${deviceId} set to ${mode}` }] };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function createServer(api: SurepetcareBackend, version: string): Server {
  const server = new Server({ name: 'mcp-server-surepetcare', version }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async request =>
    handleToolCall(request.params.name, request.params.arguments, api)
  );

  return server;
}
