import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const activitiesRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'activities', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'activities' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('activities', input, id),
  delete: deleteRecord,
};
