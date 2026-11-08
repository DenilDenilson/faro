import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const habitsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'habits', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'habits' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('habits', input, id),
  delete: deleteRecord,
};
