import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { SurepetcareAPI } from '../lib/surepetcare-api';

const CREDS = { email: 'test@example.com', password: 'secret', deviceId: 'test-device-id' };
const TOKEN = 'test-token-abc';

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(axios);
  mock.onPost('/auth/login').reply(200, { data: { token: TOKEN } });
});

afterEach(() => {
  mock.restore();
});

describe('authenticate', () => {
  it('posts credentials and caches the token', async () => {
    const api = new SurepetcareAPI(CREDS);
    await api.authenticate();
    expect(mock.history.post).toHaveLength(1);
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.email_address).toBe(CREDS.email);
    expect(body.password).toBe(CREDS.password);
    expect(body.device_id).toBe(CREDS.deviceId);
  });

  it('does not re-authenticate within 24h', async () => {
    const api = new SurepetcareAPI(CREDS);
    await api.authenticate();
    await api.authenticate();
    expect(mock.history.post).toHaveLength(1);
  });
});

describe('getPets', () => {
  it('returns pets with position data', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/pet').reply(200, {
      data: [
        { id: 1, name: 'Mittens', position: { where: 1, since: '2024-01-01T10:00:00Z' } },
        { id: 2, name: 'Shadow', position: { where: 2, since: '2024-01-01T09:00:00Z' } },
      ],
    });
    const pets = await api.getPets();
    expect(pets).toHaveLength(2);
    expect(pets[0].name).toBe('Mittens');
    expect(pets[0].position.where).toBe(1);
    expect(pets[1].name).toBe('Shadow');
    expect(pets[1].position.where).toBe(2);
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/pet').reply(200, { data: [] });
    await api.getPets();
    expect(mock.history.get[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/pet').replyOnce(401).onGet('/pet').reply(200, { data: [] });
    const pets = await api.getPets();
    expect(pets).toEqual([]);
    expect(mock.history.post).toHaveLength(2);
  });

  it('throws on 429', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/pet').reply(429);
    await expect(api.getPets()).rejects.toThrow('Rate limit exceeded');
  });
});

describe('getPetsRaw', () => {
  it('requests position and tag data and returns raw response', async () => {
    const api = new SurepetcareAPI(CREDS);
    const rawData = [
      { id: 1, name: 'Mittens', position: { where: 1 }, tag: { index: '990.000012345678' } },
    ];
    mock.onGet('/pet').reply(200, { data: rawData });
    const result = await api.getPetsRaw();
    expect(result).toEqual(rawData);
    const params = mock.history.get[0].params;
    expect(params['with[]']).toContain('tag');
    expect(params['with[]']).toContain('position');
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/pet').reply(200, { data: [] });
    await api.getPetsRaw();
    expect(mock.history.get[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('getDevices', () => {
  it('returns device list', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, {
      data: [
        { id: 10, name: 'Front Door', serial_number: 'SN001', product_id: 6, household_id: 1 },
      ],
    });
    const devices = await api.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe('Front Door');
  });

  it('requests control data so curfew schedule and live lock status are included', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, { data: [] });
    await api.getDevices();
    expect(mock.history.get[0].params['with[]']).toBe('control');
  });

  it('passes through the curfew schedule and live locking mode', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, {
      data: [
        {
          id: 10,
          name: 'Front Door',
          serial_number: 'SN001',
          product_id: 6,
          household_id: 1,
          status: { locking: { mode: -1 } },
          control: { curfew: [{ lock_time: '20:00', unlock_time: '07:00', enabled: true }] },
        },
      ],
    });
    const devices = await api.getDevices();
    expect(devices[0].status?.locking?.mode).toBe(-1);
    expect(devices[0].control?.curfew).toEqual([{ lock_time: '20:00', unlock_time: '07:00', enabled: true }]);
  });
});

describe('renameDevice', () => {
  it('sends PUT with the new name', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, { data: [] });
    mock.onPut('/device/10').reply(200, { data: {} });
    await api.renameDevice('10', 'the Meow-trix');
    const renameCall = mock.history.put.find(c => c.url === '/device/10');
    expect(JSON.parse(renameCall!.data).name).toBe('the Meow-trix');
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, { data: [] });
    mock.onPut('/device/10').reply(200, { data: {} });
    await api.renameDevice('10', 'the Bifrost');
    const renameCall = mock.history.put.find(c => c.url === '/device/10');
    expect(renameCall!.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('re-asserts an explicit lock override after renaming, so the rename endpoint cannot silently drop it', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, {
      data: [{ id: 10, name: 'Front Door', serial_number: 'SN001', product_id: 6, household_id: 1, status: { locking: { mode: 3 } } }],
    });
    mock.onPut('/device/10').reply(200, { data: {} });
    mock.onPut('/device/10/control').reply(200, { data: {} });

    await api.renameDevice('10', 'the Gates of Valhalla');

    expect(mock.history.put).toHaveLength(2);
    expect(mock.history.put[0].url).toBe('/device/10');
    expect(mock.history.put[1].url).toBe('/device/10/control');
    expect(JSON.parse(mock.history.put[1].data).locking).toBe(3);
  });

  it('does not re-assert a lock state when the device has no prior status', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, {
      data: [{ id: 10, name: 'Front Door', serial_number: 'SN001', product_id: 6, household_id: 1 }],
    });
    mock.onPut('/device/10').reply(200, { data: {} });

    await api.renameDevice('10', 'the Bifrost');

    expect(mock.history.put).toHaveLength(1);
  });

  it("does not re-assert a lock state when the flap is governed by the app's own curfew schedule", async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, {
      data: [{ id: 10, name: 'Front Door', serial_number: 'SN001', product_id: 6, household_id: 1, status: { locking: { mode: -1 } } }],
    });
    mock.onPut('/device/10').reply(200, { data: {} });

    await api.renameDevice('10', 'the Bifrost');

    expect(mock.history.put).toHaveLength(1);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, { data: [] });
    mock.onPut('/device/10').replyOnce(401).onPut('/device/10').reply(200, { data: {} });
    await expect(api.renameDevice('10', 'the Bifrost')).resolves.toBeUndefined();
    expect(mock.history.post).toHaveLength(2);
  });
});

describe('setLockState', () => {
  it('sends PUT with locking value', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/10/control').reply(200, {});
    await api.setLockState('10', 3);
    const body = JSON.parse(mock.history.put[0].data);
    expect(body.locking).toBe(3);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/10/control').replyOnce(401).onPut('/device/10/control').reply(200, {});
    await expect(api.setLockState('10', 0)).resolves.toBeUndefined();
    expect(mock.history.post).toHaveLength(2);
  });
});

describe('setPetLocation', () => {
  it('sends POST with where=1 for inside', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPost('/pet/770878/position').reply(200, { data: {} });
    await api.setPetLocation('770878', 1);
    const call = mock.history.post.find(c => c.url === '/pet/770878/position');
    expect(JSON.parse(call!.data).where).toBe(1);
  });

  it('sends POST with where=2 for outside', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPost('/pet/770878/position').reply(200, { data: {} });
    await api.setPetLocation('770878', 2);
    const call = mock.history.post.find(c => c.url === '/pet/770878/position');
    expect(JSON.parse(call!.data).where).toBe(2);
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPost('/pet/770878/position').reply(200, { data: {} });
    await api.setPetLocation('770878', 1);
    const call = mock.history.post.find(c => c.url === '/pet/770878/position');
    expect(call!.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPost('/pet/770878/position').replyOnce(401).onPost('/pet/770878/position').reply(200, { data: {} });
    await expect(api.setPetLocation('770878', 1)).resolves.toBeUndefined();
    expect(mock.history.post.filter(c => c.url === '/auth/login')).toHaveLength(2);
  });
});

describe('getPetReport', () => {
  const deviceFixture = {
    data: [{ id: 10, name: 'Front Door', serial_number: 'SN001', product_id: 6, household_id: 347011 }],
  };

  it('resolves the household ID from getDevices and calls the aggregate report endpoint', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, deviceFixture);
    mock.onGet('/report/household/347011/pet/770878/aggregate').reply(200, { data: { some: 'report' } });

    const report = await api.getPetReport('770878');

    expect(report).toEqual({ some: 'report' });
  });

  it('passes from/to as query params when both are given', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, deviceFixture);
    mock.onGet('/report/household/347011/pet/770878/aggregate').reply(200, { data: {} });

    await api.getPetReport('770878', '2026-09-01', '2026-09-12');

    const call = mock.history.get.find(c => c.url === '/report/household/347011/pet/770878/aggregate');
    expect(call!.params).toEqual({ from: '2026-09-01', to: '2026-09-12' });
  });

  it('omits from/to when not given', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, deviceFixture);
    mock.onGet('/report/household/347011/pet/770878/aggregate').reply(200, { data: {} });

    await api.getPetReport('770878');

    const call = mock.history.get.find(c => c.url === '/report/household/347011/pet/770878/aggregate');
    expect(call!.params).toEqual({});
  });

  it('throws when no devices (and so no household ID) can be found', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, { data: [] });

    await expect(api.getPetReport('770878')).rejects.toThrow('household');
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, deviceFixture);
    mock.onGet('/report/household/347011/pet/770878/aggregate').reply(200, { data: {} });

    await api.getPetReport('770878');

    const call = mock.history.get.find(c => c.url === '/report/household/347011/pet/770878/aggregate');
    expect(call!.headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onGet('/device').reply(200, deviceFixture);
    mock
      .onGet('/report/household/347011/pet/770878/aggregate')
      .replyOnce(401)
      .onGet('/report/household/347011/pet/770878/aggregate')
      .reply(200, { data: {} });

    await expect(api.getPetReport('770878')).resolves.toEqual({});
    expect(mock.history.post.filter(c => c.url === '/auth/login')).toHaveLength(2);
  });
});

describe('setLedMode', () => {
  it('sends PUT with the led_mode value', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/1/control').reply(200, { data: {} });
    await api.setLedMode('1', 1);
    const body = JSON.parse(mock.history.put[0].data);
    expect(body.led_mode).toBe(1);
  });

  it('accepts off (0) and dimmed (4)', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/1/control').reply(200, { data: {} });
    await api.setLedMode('1', 0);
    await api.setLedMode('1', 4);
    expect(JSON.parse(mock.history.put[0].data).led_mode).toBe(0);
    expect(JSON.parse(mock.history.put[1].data).led_mode).toBe(4);
  });

  it('sends Authorization header', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/1/control').reply(200, { data: {} });
    await api.setLedMode('1', 1);
    expect(mock.history.put[0].headers?.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('re-authenticates and retries on 401', async () => {
    const api = new SurepetcareAPI(CREDS);
    mock.onPut('/device/1/control').replyOnce(401).onPut('/device/1/control').reply(200, { data: {} });
    await expect(api.setLedMode('1', 1)).resolves.toBeUndefined();
    expect(mock.history.post).toHaveLength(2);
  });
});
