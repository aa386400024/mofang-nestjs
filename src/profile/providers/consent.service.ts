import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SignConsentDto, ConsentDocumentDto, ConsentSignatureDto, ConsentSectionDto } from '../dto/consent.dto';
import { ConsentSignature } from '../entities/consent-signature.entity';

/**
 * Consent service — 心塑「我的」Tab 知情同意书核心服务 (陪伴者专属).
 *
 * V2.0 实现:
 *   - 文档是 V2.0 §Tab4 6 章节静态内容 (跟前端文案 100% 一致)
 *   - 签字记录入库 (uid + version + signed_at + scrolledToBottom + ip + ua)
 *   - 防跳过阅读: 校验 scrolledToBottom=true 才接受签字
 *
 * V3 升级:
 *   - 文档版本管理 (config.consentCurrentVersion 升级时, 老签字标记 superseded)
 *   - BullMQ event bus: 签字后通知 onboarding 服务刷新陪伴者状态
 *   - 审计: 写 audit log (事件名 ConsentSigned)
 *
 * 大厂做法:
 *   - 文档版本硬校验: 后端 config 当前 version 跟签字 version 不一致 → 拒绝签字
 *     V3 改成"提示重签" 而不是拒绝 (UX 更好), 但 audit log  留痕
 *   - ip / ua 留 (个保法取证), 但加密 + 限 IP 查询 (大厂数据最小化)
 */
@Injectable()
export class ConsentService {
  /** 文档当前版本 — V2.0 硬编码, V3 走 config.consentCurrentVersion. */
  private readonly currentVersion = 'v1.0';

  constructor(
    @InjectRepository(ConsentSignature)
    private readonly repo: Repository<ConsentSignature>,
  ) {}

  /**
   * 拉取知情同意书文档.
   * V2.0 硬编码 6 章节, V3 接 i18n + 多版本管理.
   */
  async getDocument(): Promise<ConsentDocumentDto> {
    return {
      version: this.currentVersion,
      title: '陪伴者知情同意书',
      sections: this.getSections(),
    };
  }

  /**
   * 签字 — 防跳过阅读校验 scrolledToBottom=true.
   */
  async sign(uid: string, dto: SignConsentDto, ctx: { ipAddress: string; userAgent: string }): Promise<ConsentSignatureDto> {
    if (!dto.scrolledToBottom) {
      throw new Error('请先滚动到底部后再签字');
    }
    if (dto.documentVersion !== this.currentVersion) {
      throw new Error('文档版本已更新, 请重新阅读后再签字');
    }

    const signature = this.repo.create({
      uid,
      documentVersion: dto.documentVersion,
      signedAt: new Date(),
      scrolledToBottom: true,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const saved = await this.repo.save(signature);
    return {
      id: saved.id,
      documentVersion: saved.documentVersion,
      signedAt: saved.signedAt,
    };
  }

  /**
   * V2.0 §Tab4 知情同意书 6 章节 — 跟前端文案 100% 一致.
   */
  private getSections(): ConsentSectionDto[] {
    return [
      {
        title: '一、服务边界',
        body:
          '心塑 APP 为心理自助工具, 不提供诊疗服务。' +
          '陪伴者提供的倾听、情绪支持、工具推荐均不构成专业心理咨询或或。' +
          '陪伴者需要在尊重被陪伴者隐私的前提下, 提供非评判性的倾听与陪伴。',
      },
      {
        title: '二、隐私保护',
        body:
          '陪伴者只能看到被陪伴者显式授权的内容 (按 L1/L2/L3 权限等级). ' +
          '未经授权, 不得尝试获取或推断被陪伴者的其他私人信息。' +
          '陪伴者不得将被陪伴者的的或透露给第三方。',
      },
      {
        title: '三、危机干预',
        body:
          '如发现被陪伴者出现自伤/他伤风险, 陪伴者有义务: ' +
          '(1) 立即引导拨打全国心理援助热线 400-161-9995; ' +
          '(2) 同步通知心塑平台危机专员介入; ' +
          '(3) 在保证人身安全的前提下, 持续陪伴直到专业力量到达。',
      },
      {
        title: '四、资质与培训',
        body:
          '陪伴者承诺自己提供的服务基于所学心理学知识, 不冒充专业咨询师。' +
          '心塑平台会定期组织陪伴者培训, 包括危机识别、倾听技能、' +
          '边界意识等。陪伴者有义务持续学习并接受平台监督。',
      },
      {
        title: '五、解除与终止',
        body: '被陪伴者可随时单方面解除与你的绑定, 7 天内可撤回。' + '如陪伴者严重违反本协议, 心塑平台有权立即终止陪伴者身份。',
      },
      {
        title: '六、签字与生效',
        body:
          '滚动到底部后, 你可以勾选「我已阅读并同意以上所有条款」并签字。' + '签字记录将被加密保存, 后续条款更新时系统会通知你重新确认。',
      },
    ];
  }
}
