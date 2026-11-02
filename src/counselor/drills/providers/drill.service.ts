// V2026-10-27 治本 (情景演练 · 读侧服务 — 列表 / 开练详情 / 提交判定):
//   原因: 任务单 §4 拍板 3 个端点, 且对"下发什么 / 不下发什么"有硬要求:
//     · 列表只给元信息, 不给全文;
//     · 开练详情只给锚点的 key+label, **不给关键词表** (给了就能照着拼一句"通过");
//     · 判定结果才给参考回应与常见偏差.
//     这三条一旦写散在 controller 里, 迟早有人"顺手把关键词表也返回了" —— 下发答案等于
//     把练习变成背答案, 且这类泄漏不会报错, 只会被当成"接口设计如此".
//   修法: 本服务是这三个端点的**唯一出参组装点**, 下发边界在这里物理收口:
//     · list():    只映射元信息字段
//     · detail():  只映射 persona/setting/visitorPrompt/锚点 key+label/boundaryNotice
//     · respond(): 判定结果逐字段映射 (含 referenceResponse / commonPitfalls)
//     任何字段的"该不该下发"都在本文件可见, 不散落在 controller.
//
//   ── 反双胞胎 ──
//   - **不建第二份剧本读取路径**: 剧本只从 config/drill-registry.ts 取 (唯一入口).
//   - **不在 service 里做判定**: 判定在 domain/drill-judge.ts (纯函数), 本服务只编排.
//   - **不直接返回 domain 对象**: 逐字段映射到 DTO —— domain 将来加内部字段不会顺手泄到前端.
//   - **不把关键词表放进任何 DTO**: DTO 层根本没有承载它的字段, 下发在结构上不可能.
//
//   验证:
//     1. tsc 0 错
//     2. GET /counselor/drills?track=boundary → 只含 boundary 元信息, 不含全文
//     3. GET /counselor/drills/:drillId → requiredPoints 只有 key+label, 无 positiveKeywords
//     4. POST .../respond → 出参含 referenceResponse / commonPitfalls / verdict / items
//   时间戳: 2026-10-27 21:35 GMT+8
import { Injectable } from '@nestjs/common';

import { DrillEvaluatorService } from './drill-evaluator.service';
import { BizCode } from '../../../common/exceptions/biz-code.enum';
import { BizException } from '../../../common/exceptions/biz.exception';
import { findDrillScript, listDrillScripts } from '../config/drill-registry';
import type { DrillItem, DrillScript } from '../domain/drill.types';
import type { DrillListDto, DrillDetailDto, DrillResponseDto, SubmitDrillResponseDto } from '../dto/drill.dto';

/**
 * 情景演练读侧服务.
 */
@Injectable()
export class DrillService {
  constructor(private readonly evaluator: DrillEvaluatorService) {}

  /**
   * 列表 (元信息).
   *
   * @param track 赛道过滤 (不传 = 全部)
   * @returns 剧本元信息清单
   */
  list(track?: DrillScript['track']): DrillListDto {
    const scripts = listDrillScripts(track);
    return {
      drills: scripts.map((script) => ({
        drillId: script.drillId,
        track: script.track,
        difficulty: script.difficulty,
        title: script.title,
        setting: script.setting,
        boundaryNotice: script.boundaryNotice ?? '',
      })),
    };
  }

  /**
   * 开练详情 (只给开练所需).
   *
   * @param drillId 剧本 slug
   * @returns 开练详情; 找不到 → 404
   */
  detail(drillId: string): DrillDetailDto {
    const script = this.requireScript(drillId);
    return {
      drillId: script.drillId,
      track: script.track,
      difficulty: script.difficulty,
      title: script.title,
      persona: {
        name: script.persona.name,
        age: script.persona.age,
        gender: script.persona.gender,
        occupation: script.persona.occupation,
        background: script.persona.background,
      },
      setting: script.setting,
      visitorPrompt: script.visitorPrompt,
      // 只给 key+label: 关键词表留在服务端 (下发即发答案).
      requiredPoints: script.requiredPoints.map((point) => ({ key: point.key, label: point.label })),
      boundaryNotice: script.boundaryNotice ?? '',
    };
  }

  /**
   * 提交回应并出判定.
   *
   * @param userId 当前用户 id
   * @param drillId 剧本 slug
   * @param dto 提交内容
   * @returns 判定结果; 找不到剧本 → 404
   */
  async respond(userId: string, drillId: string, dto: SubmitDrillResponseDto): Promise<DrillResponseDto> {
    const script = this.requireScript(drillId);
    const result = await this.evaluator.evaluate(script, dto.submittedText, userId);
    return {
      drillId: result.drillId,
      track: result.track,
      verdict: result.verdict,
      coveredPointKeys: result.coveredPointKeys,
      missedPointKeys: result.missedPointKeys,
      items: result.items.map((item: DrillItem) => ({
        tone: item.tone,
        pointKey: item.pointKey,
        text: item.text,
      })),
      referenceResponse: result.referenceResponse,
      commonPitfalls: result.commonPitfalls,
      source: result.source,
    };
  }

  /**
   * 取剧本 (找不到抛 404).
   *
   * @param drillId 剧本 slug
   * @returns 剧本
   */
  private requireScript(drillId: string): DrillScript {
    const script = findDrillScript(drillId);
    if (script === null) {
      throw new BizException(BizCode.ResourceNotFound, '该情景演练剧本不存在或暂不可用');
    }
    return script;
  }
}
