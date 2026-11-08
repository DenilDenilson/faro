import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const areasRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'areas', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'areas' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('areas', input, id),
  delete: deleteRecord,
};
