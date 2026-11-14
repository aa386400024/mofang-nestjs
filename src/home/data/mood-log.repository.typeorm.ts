// V2026-11-15 治本 (TD-20 · C2 第四批仓储端口化 · home 域 · P-DEBT-11 / L-1):
//   `MoodLogRepository` 端口的 TypeORM 实现 —— home 域**唯一**允许出现
//   typeorm 值符号的业务文件 (module 装配层除外).
//
//   治本:
//     - **实体工厂下沉实现层** (对齐 TD-18 先例): 工厂 + 保存两条动作在本实现内
//       一次完成, service 侧零工厂依赖
//     - 查询口径全部下沉: uid 过滤 + created_at 下界 + 倒序取一条 (今日最新)
//       / 正序取全量 (近 N 天曲线)
//     - 物理删除 (真删, 不软删) + affected 行数回传
//     - 实现不写新口径、不加新条件 —— 本单是结构重构, 不是查询优化
//     - 不暴露 EntityManager / 查询选项给上层
//     - **不吞异常** —— 写失败要冒到 service (service 现有语义逐字保留)
//
//   反双胞胎:
//     - 不把实体行漏给 service —— 端口出参是 Row 领域类型 (窄字段)
//     - 实体 → Row 映射只在本实现内做, service 零映射职责
//
//   如何验证:
//     1. tsc 0 错; module provider 接线后打卡相关端点口径不变
//     2. 单元测试用端口替身驱动 service (不起真 TypeORM / 不连 DB)
//   时间戳: 2026-11-15 GMT+8

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import type { MoodLogRepository, MoodLogRow, NewMoodLogInput } from '../domain/repositories/mood-log.repository.js';
import { MoodLog } from '../entities/mood-log.entity.js';

/**
 * 情绪打卡仓储 (TypeORM 真库实现).
 */
@Injectable()
export class MoodLogRepositoryTypeorm implements MoodLogRepository {
  /**
   * @param repo 情绪打卡实体仓储
   */
  constructor(
    @InjectRepository(MoodLog)
    private readonly repo: Repository<MoodLog>,
  ) {}

  /**
   * 写入一条打卡 —— 实体工厂 + 保存 (两条动作在本实现内一次完成).
   *
   * @param input 写入入参 (纯对象)
   * @returns 落库后的行
   */
  async create(input: NewMoodLogInput): Promise<MoodLogRow> {
    const saved = await this.repo.save(
      this.repo.create({
        uid: input.uid,
        level: input.level,
        note: input.note,
        triggeredMicroInterventionId: input.triggeredMicroInterventionId,
      }),
    );
    return toRow(saved);
  }

  /**
   * 取窗口内最新一条 —— uid + created_at 下界 + 倒序取一条.
   *
   * @param uid 用户 id
   * @param since 窗口起点 (created_at 下界)
   * @returns 行 (未命中返 null)
   */
  async findLatestSince(uid: string, since: Date): Promise<MoodLogRow | null> {
    const row = await this.repo.findOne({
      where: { uid, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'DESC' },
    });
    return row ? toRow(row) : null;
  }

  /**
   * 取窗口内全部 —— uid + created_at 下界 + 正序.
   *
   * @param uid 用户 id
   * @param since 窗口起点 (created_at 下界)
   * @returns 行列表
   */
  async findRecentSince(uid: string, since: Date): Promise<MoodLogRow[]> {
    const rows = await this.repo.find({
      where: { uid, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => toRow(row));
  }

  /**
   * 按用户物理删除全部打卡 (真删 —— 心理数据, 用户主动删除不保留).
   *
   * @param uid 用户 id
   * @returns 删除条数
   */
  async deleteByUser(uid: string): Promise<number> {
    const result = await this.repo.delete({ uid });
    return result.affected ?? 0;
  }
}

/** entity → Row 映射 (窄字段, 本表真删无软删列). */
function toRow(entity: MoodLog): MoodLogRow {
  return {
    id: entity.id,
    uid: entity.uid,
    level: entity.level,
    note: entity.note,
    triggeredMicroInterventionId: entity.triggeredMicroInterventionId,
    createdAt: entity.createdAt,
  };
}
