import { getSettings, updateSettings } from '../data/repository';

export const settingsRepository = { get: getSettings, update: updateSettings };
