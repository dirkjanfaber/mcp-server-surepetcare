import { jest } from '@jest/globals';
import { handleToolCall } from '../server';
import { SurepetcareBackend } from '../types/surepetcare';

function makeApi(overrides: Partial<SurepetcareBackend> = {}): SurepetcareBackend {
  return {
    authenticate: jest.fn(),
    getPets: jest.fn().mockResolvedValue([]),
    getPetsRaw: jest.fn().mockResolvedValue([]),
    getDevices: jest.fn().mockResolvedValue([]),
    setLockState: jest.fn().mockResolvedValue(undefined),
    renameDevice: jest.fn().mockResolvedValue(undefined),
    setPetLocation: jest.fn().mockResolvedValue(undefined),
    setLedMode: jest.fn().mockResolvedValue(undefined),
    getPetReport: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function textOf(result: { content: { type: string; text: string }[] }): string {
  return result.content[0].text;
}

describe('list_pets', () => {
  it('maps position.where to a location string', async () => {
    const api = makeApi({
      getPets: jest.fn().mockResolvedValue([
        { id: 1, name: 'Mittens', position: { where: 1, since: '2024-01-01T10:00:00Z' } },
        { id: 2, name: 'Shadow', position: { where: 2, since: '2024-01-01T09:00:00Z' } },
      ]),
    });
    const result = await handleToolCall('list_pets', {}, api);
    const parsed = JSON.parse(textOf(result));
    expect(parsed[0].location).toBe('inside');
    expect(parsed[1].location).toBe('outside');
  });
});

describe('get_pet_details', () => {
  it('returns the raw payload from the API', async () => {
    const api = makeApi({ getPetsRaw: jest.fn().mockResolvedValue([{ id: 1, tag: { index: '990.1' } }]) });
    const result = await handleToolCall('get_pet_details', {}, api);
    expect(JSON.parse(textOf(result))).toEqual([{ id: 1, tag: { index: '990.1' } }]);
  });
});

describe('list_devices', () => {
  it('includes a human-readable locking mode label', async () => {
    const api = makeApi({
      getDevices: jest.fn().mockResolvedValue([
        { id: 10, name: 'Front Door', serial_number: 'SN1', product_id: 6, household_id: 1, status: { locking: { mode: -1 } } },
      ]),
    });
    const result = await handleToolCall('list_devices', {}, api);
    const parsed = JSON.parse(textOf(result));
    expect(parsed[0].lockingMode).toBe(-1);
    expect(parsed[0].lockingModeLabel).toBe('curfew locked');
  });

  it('falls back to a generic label for an unrecognised mode', async () => {
    const api = makeApi({
      getDevices: jest.fn().mockResolvedValue([
        { id: 10, name: 'Front Door', serial_number: 'SN1', product_id: 6, household_id: 1, status: { locking: { mode: 7 as any } } },
      ]),
    });
    const result = await handleToolCall('list_devices', {}, api);
    expect(JSON.parse(textOf(result))[0].lockingModeLabel).toBe('mode 7');
  });
});

describe('set_lock_state', () => {
  it('calls setLockState with validated args', async () => {
    const api = makeApi();
    await handleToolCall('set_lock_state', { deviceId: '10', lockState: 3 }, api);
    expect(api.setLockState).toHaveBeenCalledWith('10', 3);
  });

  it('rejects a lockState outside 0-3', async () => {
    const api = makeApi();
    await expect(handleToolCall('set_lock_state', { deviceId: '10', lockState: 9 }, api)).rejects.toThrow();
    expect(api.setLockState).not.toHaveBeenCalled();
  });

  it('rejects a missing deviceId', async () => {
    const api = makeApi();
    await expect(handleToolCall('set_lock_state', { lockState: 1 }, api)).rejects.toThrow();
  });
});

describe('rename_device', () => {
  it('calls renameDevice with validated args', async () => {
    const api = makeApi();
    await handleToolCall('rename_device', { deviceId: '10', name: 'the Bifrost' }, api);
    expect(api.renameDevice).toHaveBeenCalledWith('10', 'the Bifrost');
  });

  it('rejects an empty name', async () => {
    const api = makeApi();
    await expect(handleToolCall('rename_device', { deviceId: '10', name: '' }, api)).rejects.toThrow();
  });
});

describe('set_pet_location', () => {
  it('maps "inside" to where=1', async () => {
    const api = makeApi();
    await handleToolCall('set_pet_location', { petId: '5', location: 'inside' }, api);
    expect(api.setPetLocation).toHaveBeenCalledWith('5', 1);
  });

  it('maps "outside" to where=2', async () => {
    const api = makeApi();
    await handleToolCall('set_pet_location', { petId: '5', location: 'outside' }, api);
    expect(api.setPetLocation).toHaveBeenCalledWith('5', 2);
  });

  it('rejects an invalid location', async () => {
    const api = makeApi();
    await expect(handleToolCall('set_pet_location', { petId: '5', location: 'sideways' }, api)).rejects.toThrow();
  });
});

describe('set_led_mode', () => {
  it('calls setLedMode with validated args', async () => {
    const api = makeApi();
    await handleToolCall('set_led_mode', { deviceId: '1', mode: 4 }, api);
    expect(api.setLedMode).toHaveBeenCalledWith('1', 4);
  });

  it('rejects a mode outside 0/1/4', async () => {
    const api = makeApi();
    await expect(handleToolCall('set_led_mode', { deviceId: '1', mode: 2 }, api)).rejects.toThrow();
  });
});

describe('get_pet_report', () => {
  it('calls getPetReport with just petId when no date range is given', async () => {
    const api = makeApi();
    await handleToolCall('get_pet_report', { petId: '5' }, api);
    expect(api.getPetReport).toHaveBeenCalledWith('5', undefined, undefined);
  });

  it('calls getPetReport with the date range when both dates are given', async () => {
    const api = makeApi();
    await handleToolCall('get_pet_report', { petId: '5', fromDate: '2026-09-01', toDate: '2026-09-12' }, api);
    expect(api.getPetReport).toHaveBeenCalledWith('5', '2026-09-01', '2026-09-12');
  });

  it('returns the report as JSON text', async () => {
    const api = makeApi({ getPetReport: jest.fn().mockResolvedValue({ time_outside: 3600 }) });
    const result = await handleToolCall('get_pet_report', { petId: '5' }, api);
    expect(JSON.parse(textOf(result))).toEqual({ time_outside: 3600 });
  });

  it('rejects a fromDate without a matching toDate', async () => {
    const api = makeApi();
    await expect(handleToolCall('get_pet_report', { petId: '5', fromDate: '2026-09-01' }, api)).rejects.toThrow();
  });

  it('rejects a malformed date', async () => {
    const api = makeApi();
    await expect(
      handleToolCall('get_pet_report', { petId: '5', fromDate: '09/01/2026', toDate: '2026-09-12' }, api)
    ).rejects.toThrow();
  });

  it('rejects a missing petId', async () => {
    const api = makeApi();
    await expect(handleToolCall('get_pet_report', {}, api)).rejects.toThrow();
  });
});

describe('unknown tool', () => {
  it('throws', async () => {
    const api = makeApi();
    await expect(handleToolCall('does_not_exist', {}, api)).rejects.toThrow('Unknown tool');
  });
});
