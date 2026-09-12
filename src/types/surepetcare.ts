export type LockState = 0 | 1 | 2 | 3;

// Hub LED ring brightness: 0 = off, 1 = bright, 4 = dimmed.
export type LedMode = 0 | 1 | 4;

// As reported by device.status.locking.mode: the settable LockState values,
// plus 4 (locking deferred to the curfew schedule) and the read-only
// states the device reports while curfew is in effect.
export type DeviceLockingMode = LockState | 4 | -1 | -2 | -3;

export interface CurfewWindow {
  lock_time: string;
  unlock_time: string;
  enabled: boolean;
}

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
  status?: {
    locking?: {
      mode: DeviceLockingMode;
    };
  };
  control?: {
    curfew?: CurfewWindow[];
  };
}

export interface SurepetcareCredentials {
  email: string;
  password: string;
  deviceId: string;
}

export interface SurepetcareBackend {
  authenticate(): Promise<void>;
  getPets(): Promise<Pet[]>;
  getPetsRaw(): Promise<unknown>;
  getDevices(): Promise<Device[]>;
  setLockState(deviceId: string, state: LockState): Promise<void>;
  renameDevice(deviceId: string, name: string): Promise<void>;
  setPetLocation(petId: string, where: 1 | 2): Promise<void>;
  setLedMode(deviceId: string, mode: LedMode): Promise<void>;
  getPetReport(petId: string, fromDate?: string, toDate?: string): Promise<unknown>;
}
