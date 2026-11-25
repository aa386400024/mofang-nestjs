/**
 * 轻量规则 DSL — 与 `flex-rules-engine` 的条件/动作形状保持兼容。
 *
 * 为什么不在本仓直接安装官方包：
 *   - 1.0.23 的根导出会拉起 @nestjs/mongoose / @nestjs/swagger@11，且 peer 依赖 Nest 10；
 *   - 当前仓是 Nest 12 + Express 5，直接安装会给生产依赖树引入两套 Nest 和 Mongo 适配层；
 *   - 会员活动只需要“字段比较 + 命中标记”，不需要 Mongo 持久化和管理 UI。
 * 因此这里保留同一份规则形状，但实现为纯函数、零网络、零动态代码执行。
 */

export type FlexRuleOperator =
  'equals' | 'notEquals' | 'in' | 'contains' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';

export interface FlexCondition {
  readonly field: string;
  readonly operator: FlexRuleOperator;
  readonly value: unknown;
}

export interface FlexConditionGroup {
  readonly operator: 'AND' | 'OR';
  readonly rules: readonly (FlexCondition | FlexConditionGroup)[];
}

export interface FlexAction {
  readonly type: 'set_value';
  readonly target: string;
  readonly value: unknown;
}

export interface FlexRule {
  readonly id: string;
  readonly conditions: FlexConditionGroup;
  readonly actions?: readonly FlexAction[];
}

export interface FlexEvaluationResult {
  readonly matched: boolean;
  readonly outputs: Readonly<Record<string, unknown>>;
}

/** 纯函数求值；字段取扁平 key，避免引入 JSONPath。 */
export function evaluateFlexRule(rule: FlexRule, data: Readonly<Record<string, unknown>>): FlexEvaluationResult {
  const matched = evaluateGroup(rule.conditions, data);
  if (!matched) return { matched: false, outputs: {} };

  const outputs: Record<string, unknown> = {};
  for (const action of rule.actions ?? []) {
    if (action.type === 'set_value') outputs[action.target] = action.value;
  }
  return { matched: true, outputs };
}

function evaluateGroup(group: FlexConditionGroup, data: Readonly<Record<string, unknown>>): boolean {
  if (group.rules.length === 0) return true;
  const results = group.rules.map((item) => ('field' in item ? evaluateCondition(item, data) : evaluateGroup(item, data)));
  return group.operator === 'AND' ? results.every(Boolean) : results.some(Boolean);
}

function evaluateCondition(condition: FlexCondition, data: Readonly<Record<string, unknown>>): boolean {
  const actual = data[condition.field];
  switch (condition.operator) {
    case 'equals':
      return actual === condition.value;
    case 'notEquals':
      return actual !== condition.value;
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
    case 'greaterThan':
      return compare(actual, condition.value) > 0;
    case 'greaterThanOrEqual':
      return compare(actual, condition.value) >= 0;
    case 'lessThan':
      return compare(actual, condition.value) < 0;
    case 'lessThanOrEqual':
      return compare(actual, condition.value) <= 0;
    default:
      return false;
  }
}

function compare(left: unknown, right: unknown): number {
  const a = typeof left === 'number' ? left : Number(left);
  const b = typeof right === 'number' ? right : Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return a - b;
}
