// V2026-09-04 治本 (V6.0 §3.5 + §12 RAG):
//   RAG controller — admin 后台 / 调试用知识库摄取 + 检索.
//   端点:
//     POST /ai/knowledge/ingest            - 摄取单篇文章
//     POST /ai/knowledge/search            - 检索 (admin 调试用, 走 RagService)
//     DELETE /ai/knowledge/:collection/:id - 删除单篇 (下架 / GDPR)

import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../user/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard';
import type { IngestArticleDto, IngestResponseDto, SearchHitDto, SearchRequestDto, SearchResponseDto } from '../dto/rag.dto';
import { QdrantService } from '../providers/qdrant.service';
import { RagService } from '../providers/rag.service';

@ApiTags('ai-knowledge')
@Controller('ai/knowledge')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RagController {
  constructor(
    private readonly rag: RagService,
    private readonly qdrant: QdrantService,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '摄取单篇心理学文章 / 练习方案到知识库' })
  public async ingest(@CurrentUser('userId') _uid: string, @Body() dto: IngestArticleDto): Promise<IngestResponseDto> {
    const start = Date.now();
    await this.rag.ingestArticle(dto.collection, {
      id: dto.id,
      title: dto.title,
      summary: dto.summary,
      content: dto.content,
      tags: dto.tags,
    });
    return {
      id: dto.id,
      collection: dto.collection,
      dimension: 0,
      ingestedAtMs: start,
    };
  }

  /**
   * 检索 — admin 调试 / preview.
   *
   * V2026-09-04 治本: 内部 embed + qdrant search 全自动; caller 只传 query.
   * 注意: searchResponse 的 hits 字段当前是空占位 — RagService V3 接
   *   searchPublic() 之后这里会填充真实命中.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '检索知识库 — admin 调试 / preview' })
  public async search(_body: SearchRequestDto): Promise<SearchResponseDto> {
    // V2.0 占位: admin search 走 RagService.buildContext (已有), 这里直接
    //   返回空 hits — admin 用 LlmOrchestratorService 的 chatOnce 调
    //   tier=rag 看完整链路 (含 prompt 拼装) 更直观.
    return { hits: [] as SearchHitDto[], count: 0 };
  }

  @Delete(':collection/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '删除单篇 (下架 / GDPR)' })
  public async delete(
    @Param('collection') collection: string,
    @Param('id') id: string,
  ): Promise<{ deleted: true; id: string; collection: string }> {
    await this.qdrant.delete(collection, id);
    return { deleted: true, id, collection };
  }
}
