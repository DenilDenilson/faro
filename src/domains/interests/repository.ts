import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const interestsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'interests', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'interests' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('interests', input, id),
  delete: deleteRecord,
};
