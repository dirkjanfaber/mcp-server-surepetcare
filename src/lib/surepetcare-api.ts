import axios, { AxiosInstance } from 'axios';
import { Device, LedMode, LockState, Pet, SurepetcareBackend, SurepetcareCredentials } from '../types/surepetcare.js';

const BASE_URL = 'https://app.api.surehub.io/api';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class SurepetcareAPI implements SurepetcareBackend {
  private credentials: SurepetcareCredentials;
  private token: string | null = null;
  private tokenExpiresAt: number = 0;
  private http: AxiosInstance;

  constructor(credentials: SurepetcareCredentials) {
    this.credentials = credentials;
    this.http = axios.create({ baseURL: BASE_URL });
  }

  async authenticate(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return;
    }
    const response = await this.http.post('/auth/login', {
      email_address: this.credentials.email,
      password: this.credentials.password,
      device_id: this.credentials.deviceId,
    });
    this.token = response.data.data.token;
    this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        this.token = null;
        await this.authenticate();
        return await fn();
      }
      if (err?.response?.status === 429) {
        throw new Error('Rate limit exceeded - back off before retrying');
      }
      throw err;
    }
  }

  async getPets(): Promise<Pet[]> {
    await this.authenticate();
    return this.withRetry(async () => {
      const response = await this.http.get('/pet', {
        params: { 'with[]': 'position' },
        headers: this.authHeaders(),
      });
      return response.data.data as Pet[];
    });
  }

  async getPetsRaw(): Promise<unknown> {
    await this.authenticate();
    return this.withRetry(async () => {
      const response = await this.http.get('/pet', {
        params: { 'with[]': ['position', 'tag'] },
        headers: this.authHeaders(),
      });
      return response.data.data;
    });
  }

  async getDevices(): Promise<Device[]> {
    await this.authenticate();
    return this.withRetry(async () => {
      const response = await this.http.get('/device', {
        params: { 'with[]': 'control' },
        headers: this.authHeaders(),
      });
      return response.data.data as Device[];
    });
  }

  async setLockState(deviceId: string, state: LockState): Promise<void> {
    await this.authenticate();
    return this.withRetry(async () => {
      await this.http.put(`/device/${deviceId}/control`, { locking: state }, {
        headers: this.authHeaders(),
      });
    });
  }

  async renameDevice(deviceId: string, name: string): Promise<void> {
    await this.authenticate();

    // PUT /device/{id} (unlike /device/{id}/control) has been observed to
    // reset the device's lock override to unlocked as a side effect of the
    // rename, even though locking isn't part of this request body. Capture
    // whatever lock state was active beforehand and re-assert it once the
    // rename completes, so a curfew-driven lock doesn't silently get
    // dropped by an unrelated rename.
    const devices = await this.getDevices();
    const priorLockState = devices.find(d => String(d.id) === deviceId)?.status?.locking?.mode;

    await this.withRetry(async () => {
      await this.http.put(`/device/${deviceId}`, { name }, {
        headers: this.authHeaders(),
      });
    });

    if (priorLockState !== undefined && priorLockState >= 0 && priorLockState <= 3) {
      // Explicit override was active - restore the exact same value.
      await this.setLockState(deviceId, priorLockState as LockState);
    } else if (priorLockState === -1) {
      // Curfew's own one-way lock (exit blocked, entry allowed) is subject to
      // the same reset - restore its explicit equivalent rather than trusting
      // the app's curfew schedule to reassert it before a cat pushes through.
      await this.setLockState(deviceId, 1);
    }
    // -2 (curfew released), -3 (unknown), and 4 (curfew scheduled but not yet
    // active) don't represent an active exit-blocking state, so there's
    // nothing to restore.
  }

  async setPetLocation(petId: string, where: 1 | 2): Promise<void> {
    await this.authenticate();
    return this.withRetry(async () => {
      // "Y-m-d H:i", matching the reference implementation this endpoint
      // was reverse-engineered from (alextoft/sureflap's setPetLocation.php).
      const since = new Date().toISOString().slice(0, 16).replace('T', ' ');
      await this.http.post(`/pet/${petId}/position`, { where, since }, {
        headers: this.authHeaders(),
      });
    });
  }

  async setLedMode(deviceId: string, mode: LedMode): Promise<void> {
    await this.authenticate();
    return this.withRetry(async () => {
      await this.http.put(`/device/${deviceId}/control`, { led_mode: mode }, {
        headers: this.authHeaders(),
      });
    });
  }

  async getPetReport(petId: string, fromDate?: string, toDate?: string): Promise<unknown> {
    await this.authenticate();

    // The report is scoped to a household rather than a pet directly, so
    // resolve it the same way renameDevice resolves a device's prior lock
    // state: from the account's own device list, rather than asking the
    // caller for an ID they don't otherwise need.
    const devices = await this.getDevices();
    const householdId = devices[0]?.household_id;
    if (householdId === undefined) {
      throw new Error('Could not resolve a household ID (no devices found on this account)');
    }

    return this.withRetry(async () => {
      const params: Record<string, string> = fromDate && toDate ? { from: fromDate, to: toDate } : {};
      const response = await this.http.get(`/report/household/${householdId}/pet/${petId}/aggregate`, {
        params,
        headers: this.authHeaders(),
      });
      return response.data.data;
    });
  }
}
