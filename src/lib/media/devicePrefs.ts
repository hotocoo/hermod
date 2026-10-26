import { readString } from '../storage';

export type DeviceSlot = 'mic' | 'cam' | 'spk';

/** localStorage key of the device chosen in App settings, Audio and video. */
export const deviceKey = (slot: DeviceSlot): string => `hermodr.device.${slot}`;

/** The chosen device id, or undefined for the system default. */
export const storedDevice = (slot: DeviceSlot): string | undefined => readString(deviceKey(slot)) || undefined;
