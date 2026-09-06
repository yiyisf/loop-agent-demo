import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(alphabet, 16);

export const newId = (prefix: string): string => `${prefix}_${nano()}`;

export const nowIso = (): string => new Date().toISOString();
