import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const projectsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'projects', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'projects' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('projects', input, id),
  delete: deleteRecord,
};
