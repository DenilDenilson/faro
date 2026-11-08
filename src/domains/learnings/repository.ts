import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const learningsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'learnings', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'learnings' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('learnings', input, id),
  delete: deleteRecord,
};
