export interface PlanSlot {
  name: string;
  notes?: string;
  interestIds: string[];
  habitIds?: string[];
  projectIds?: string[];
  goalIds?: string[];
  estimatedMinutes?: number;
  plannedTime?: string;
}
export interface WeekPlan extends PlanSlot {
  id: string;
  kind: 'plan';
  weekStart: string;
  day?: string;
  status: 'pending' | 'completed' | 'cancelled';
  activityId?: string;
  completedAt?: string;
  sourceKey?: string;
  createdAt: string;
  updatedAt: string;
}
export interface WeekTemplate {
  id: string;
  kind: 'template';
  name: string;
  slots: (PlanSlot & { weekday?: number })[];
  createdAt: string;
  updatedAt: string;
}
export type PlanningItem = WeekPlan | WeekTemplate;
export interface PlanningHistory {
  id: string;
  itemId: string;
  occurredAt: string;
  before: PlanningItem | null;
  after: PlanningItem | null;
}
