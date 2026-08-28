import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '../user/user.module';

import { AiConversationsController } from './controllers/ai-conversations.controller';
import { ChatSession } from './entities/chat-session.entity';
import { AiConversationsService } from './providers/ai-conversations.service';

/**
 * AI 对话记录模块 — V2.0 §Tab4 「我的数据」AI 对话记录.
 *
 * V2.0 范围限定: 仅 history 浏览 + 单条详情 + 删除.
 *   - 实时对话 / 流式响应 / 消息原文存储 都不在本模块
 *   - 服务依赖 UserModule 拿 JwtAuthGuard (复用, 不重复造轮子)
 */
@Module({
  imports: [TypeOrmModule.forFeature([ChatSession]), UserModule],
  controllers: [AiConversationsController],
  providers: [AiConversationsService],
  exports: [AiConversationsService],
})
export class AiConversationsModule {}
