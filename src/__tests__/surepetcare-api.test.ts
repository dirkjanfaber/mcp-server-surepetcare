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
