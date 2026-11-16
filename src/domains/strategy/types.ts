export const RESOURCE_TYPES = ['body', 'money', 'time'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export const resourceLabels: Record<ResourceType, string> = {
  body: 'Cuerpo',
  money: 'Dinero',
  time: 'Tiempo',
};
export const STRATEGY_KINDS = ['vision', 'key', 'indicator', 'measurement', 'review'] as const;
export type StrategyKind = (typeof STRATEGY_KINDS)[number];
export interface StrategyInput {
  kind: StrategyKind;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'archived';
  purpose?: string;
  values?: string;
  boundaries?: string;
  horizon?: string;
  reviewDate?: string;
  visionIds?: string[];
  keyIds?: string[];
  recordIds?: string[];
  resourceTypes?: ResourceType[];
  requiredResources?: string;
  stage?: 'exploring' | 'practicing' | 'applied';
  evidence?: string;
  resourceType?: ResourceType;
  unit?: string;
  minimum?: number;
  maximum?: number;
  indicatorId?: string;
  value?: number;
  occurredAt?: string;
  reviewPeriod?: 'monthly' | 'quarterly' | 'custom';
  reviewDay?: string;
  reflections?: string;
  resourceReview?: string;
  capabilityReview?: string;
  decisions?: string;
  nextPriorities?: string;
}
export interface StrategyItem extends StrategyInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface StrategyHistory {
  id: string;
  itemId: string;
  occurredAt: string;
  before: StrategyItem | null;
  after: StrategyItem | null;
}
