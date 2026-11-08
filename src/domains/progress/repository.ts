import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const progressRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'progress', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'progress' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('progress', input, id),
  delete: deleteRecord,
};
