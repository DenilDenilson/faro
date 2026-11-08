export const ENTITY_TYPES = [
  'areas',
  'interests',
  'goals',
  'habits',
  'projects',
  'milestones',
  'activities',
  'reviews',
  'seasons',
  'learnings',
  'progress',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
export type RecordStatus =
  'active' | 'paused' | 'archived' | 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type Cadence = 'daily' | 'weekly' | 'monthly' | 'interval' | 'custom';
export type AlertType = 'interest' | 'habit' | 'review' | 'goal' | 'project';

/** All dates are ISO instants; date-only fields use YYYY-MM-DD in the configured zone. */
export interface FaroRecord {
  id: string;
  type: EntityType;
  name: string;
  description: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  areaId?: string;
  interestIds?: string[];
  habitIds?: string[];
  projectIds?: string[];
  goalIds?: string[];
  learningIds?: string[];
  parentId?: string;
  activityId?: string;
  color?: string;
  icon?: string;
  order?: number;
  priority?: number;
  frequencyDays?: number;
  cadence?: Cadence;
  targetCount?: number;
  targetMinutes?: number;
  intervalDays?: number;
  weekdays?: number[];
  targetValue?: number;
  currentValue?: number;
  baselineValue?: number;
  unit?: string;
  outcomes?: string;
  occurredAt?: string;
  durationMinutes?: number;
  startDate?: string;
  endDate?: string;
  weekStart?: string;
  reflections?: string;
  achievements?: string;
  difficulties?: string;
  decisions?: string;
  nextPriorities?: string;
  focusIds?: string[];
  maintenanceIds?: string[];
  explorationIds?: string[];
  tags?: string[];
  references?: string[];
  notes?: string;
  value?: number;
  idempotencyKey?: string;
}

export type RecordInput = Omit<FaroRecord, 'id' | 'type' | 'createdAt' | 'updatedAt'>;
export interface Settings {
  timezone: string;
  theme: 'light' | 'dark' | 'system';
  attentionWarningRatio: number;
  projectIdleDays: number;
  goalDueDays: number;
  showStreaks: boolean;
  alertPreferences: Record<AlertType, boolean>;
  dismissedAlerts: Record<string, string>;
  snoozedAlerts: Record<string, string>;
}

export interface HistoryEntry {
  id: string;
  recordId: string;
  type: EntityType;
  occurredAt: string;
  operation: 'create' | 'update' | 'delete';
  before: FaroRecord | null;
  after: FaroRecord | null;
}
export interface FaroSnapshot {
  records: FaroRecord[];
  settings: Settings;
  history: HistoryEntry[];
  generatedAt: string;
}
export interface SnapshotOptions {
  from?: string;
  to?: string;
  types?: EntityType[];
  historySince?: string;
  includeHistory?: boolean;
}
export interface ListRecordOptions {
  type?: EntityType;
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  areaId?: string;
  interestId?: string;
  parentId?: string;
}
export interface FaroBackup {
  format: 'faro';
  version: 1;
  exportedAt: string;
  records: FaroRecord[];
  settings: Settings;
  history: HistoryEntry[];
}
export interface ImportPreview {
  version: 1;
  total: number;
  newRecords: number;
  duplicates: number;
  conflicts: number;
  byType: Partial<Record<EntityType, number>>;
  warnings: string[];
  digest: string;
}

export const DEFAULT_SETTINGS: Settings = {
  timezone: 'America/Lima',
  theme: 'system',
  attentionWarningRatio: 0.8,
  projectIdleDays: 14,
  goalDueDays: 7,
  showStreaks: false,
  alertPreferences: { interest: true, habit: true, review: true, goal: true, project: true },
  dismissedAlerts: {},
  snoozedAlerts: {},
};
