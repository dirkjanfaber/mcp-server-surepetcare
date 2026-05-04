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
