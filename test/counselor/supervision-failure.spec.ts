// V2026-10-27 治本 (督导失败分类 — 纯函数单测, spec 任务 D1):
//   原因: 失败分类判错, 代价是**双向**的:
//     · 把瞬时故障判成永久 → 不该丢的报告永远出不来 (学员白等)
//     · 把永久失败判成瞬时 → 刷 3 遍错误日志 + 拖 3 次退避 + 队列里堆失败 job
//     而且失败原因码会直接透给前端 (决定要不要给"重试"按钮), 判错就是用户点重试白点.
//   修法: 本文件锁死:
//     ① LLM errorCode → 失败原因码的映射
//     ② 异常 → 失败分类 (永久 / 可重试)
//   验证: npx jest test/counselor/supervision-failure.spec.ts 全绿
//   时间戳: 2026-10-27 14:25 GMT+8
import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import { SupervisionFailureCode } from '../../src/counselor/enums/supervision-failure-code.enum';
import {
  classifySupervisionFailure,
  isPermanentSupervisionFailure,
  mapLlmErrorCodeToFailureCode,
  SupervisionEmptyMaterialException,
  SupervisionSchoolMissingException,
  SupervisionUpstreamException,
} from '../../src/counselor/providers/supervision-failure';

describe('LLM errorCode → 失败原因码', () => {
  it('429 → rate_limited (退避后重试有意义)', () => {
    expect(mapLlmErrorCodeToFailureCode('http_429')).toBe(SupervisionFailureCode.RATE_LIMITED);
  });

  it('超时相关 → timeout', () => {
    expect(mapLlmErrorCodeToFailureCode('timeout')).toBe(SupervisionFailureCode.TIMEOUT);
  });

  it('JSON / schema 校验类 → parse_failed', () => {
    for (const code of ['json_not_found', 'json_parse_failed', 'schema_validation_failed', 'parse_error']) {
      expect(mapLlmErrorCodeToFailureCode(code)).toBe(SupervisionFailureCode.PARSE_FAILED);
    }
  });

  it('5xx / 连接失败 / 空响应 → upstream_unavailable', () => {
    for (const code of ['http_500', 'fetch_error', 'no_body', 'llm_error']) {
      expect(mapLlmErrorCodeToFailureCode(code)).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    }
  });

  it('空 / 未知错误码 → upstream_unavailable (不猜, 归到最保守的一档)', () => {
    expect(mapLlmErrorCodeToFailureCode(null)).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(mapLlmErrorCodeToFailureCode()).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(mapLlmErrorCodeToFailureCode('  ')).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(mapLlmErrorCodeToFailureCode('http_401')).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
  });
});

describe('失败分类', () => {
  it('素材不足 → empty_material + 永久 (重试多少次都是空)', () => {
    const classification = classifySupervisionFailure(new SupervisionEmptyMaterialException('没有对话内容'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.EMPTY_MATERIAL);
    expect(classification.permanent).toBe(true);
  });

  it('流派缺种子 → school_missing + 永久', () => {
    const classification = classifySupervisionFailure(new SupervisionSchoolMissingException('流派不存在'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.SCHOOL_MISSING);
    expect(classification.permanent).toBe(true);
  });

  it('上游故障 → 携带的原因码 + 可重试', () => {
    const classification = classifySupervisionFailure(new SupervisionUpstreamException(SupervisionFailureCode.RATE_LIMITED, 'HTTP 429'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.RATE_LIMITED);
    expect(classification.permanent).toBe(false);
  });

  it('裸 BadRequestException → empty_material + 永久 (兼容既有抛错点)', () => {
    const classification = classifySupervisionFailure(new BadRequestException('没有对话记录'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.EMPTY_MATERIAL);
    expect(classification.permanent).toBe(true);
  });

  it('裸 NotFoundException → school_missing + 永久', () => {
    const classification = classifySupervisionFailure(new NotFoundException('流派不存在'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.SCHOOL_MISSING);
    expect(classification.permanent).toBe(true);
  });

  it('裸 ServiceUnavailableException → upstream_unavailable + 可重试', () => {
    const classification = classifySupervisionFailure(new ServiceUnavailableException('LLM 不可用'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(classification.permanent).toBe(false);
  });

  it('未知异常 → upstream_unavailable + 可重试 (未知多半是偶发故障)', () => {
    const classification = classifySupervisionFailure(new Error('boom'));
    expect(classification.failureCode).toBe(SupervisionFailureCode.UPSTREAM_UNAVAILABLE);
    expect(classification.permanent).toBe(false);
  });

  it('非异常值 (字符串 / null) 也不炸', () => {
    expect(classifySupervisionFailure('boom').permanent).toBe(false);
    expect(classifySupervisionFailure(null).permanent).toBe(false);
    expect(classifySupervisionFailure().permanent).toBe(false);
  });
});

describe('isPermanentSupervisionFailure (兼容旧口径)', () => {
  it('永久性失败 → true', () => {
    expect(isPermanentSupervisionFailure(new SupervisionEmptyMaterialException('x'))).toBe(true);
    expect(isPermanentSupervisionFailure(new SupervisionSchoolMissingException('x'))).toBe(true);
  });

  it('上游故障 → false (BullMQ 退避重试有意义)', () => {
    expect(isPermanentSupervisionFailure(new SupervisionUpstreamException(SupervisionFailureCode.TIMEOUT, 'x'))).toBe(false);
  });
});
