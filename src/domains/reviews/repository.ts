import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const reviewsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'reviews', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'reviews' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('reviews', input, id),
  delete: deleteRecord,
};
