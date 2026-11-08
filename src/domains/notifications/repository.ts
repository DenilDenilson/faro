import { getSettings, updateAlertState } from '../data/repository';

export const notificationsRepository = {
  getPreferences: getSettings,
  updateState: updateAlertState,
};
