import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const goalsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'goals', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'goals' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('goals', input, id),
  delete: deleteRecord,
};
