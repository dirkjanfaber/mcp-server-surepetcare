export type LockState = 0 | 1 | 2 | 3;

export interface Pet {
  id: number;
  name: string;
  position: {
    where: 1 | 2;
    since?: string;
  };
}

export interface Device {
  id: number;
  name: string;
  serial_number: string;
  product_id: number;
  household_id: number;
}

export interface SurepetcareCredentials {
  email: string;
  password: string;
  deviceId: string;
}

export interface SurepetcareBackend {
  authenticate(): Promise<void>;
  getPets(): Promise<Pet[]>;
  getDevices(): Promise<Device[]>;
  setLockState(deviceId: string, state: LockState): Promise<void>;
}
