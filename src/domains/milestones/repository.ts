import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const milestonesRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'milestones', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'milestones' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('milestones', input, id),
  delete: deleteRecord,
};
