import axios, { AxiosInstance } from 'axios';
import { Device, LockState, Pet, SurepetcareBackend, SurepetcareCredentials } from '../types/surepetcare.js';

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

  async getDevices(): Promise<Device[]> {
    await this.authenticate();
    return this.withRetry(async () => {
      const response = await this.http.get('/device', {
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
}
