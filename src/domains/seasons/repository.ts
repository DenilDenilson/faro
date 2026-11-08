import { deleteRecord, getRecord, listRecords, saveRecord } from '../data/repository';
import type { RecordInput } from '../../lib/types';

export const seasonsRepository = {
  list: (limit = 100, offset = 0) => listRecords({ type: 'seasons', limit, offset }),
  get: async (id: string) => {
    const record = await getRecord(id);
    return record?.type === 'seasons' ? record : null;
  },
  save: (input: RecordInput, id?: string) => saveRecord('seasons', input, id),
  delete: deleteRecord,
};
