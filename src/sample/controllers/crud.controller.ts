import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  NotFoundException,
  InternalServerErrorException,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';

import type { Sampletable1 } from '#entity/sampledb1/index.js';
import { Roles, RolesGuard } from '../../common/index.js';
import { JwtAuthGuard } from '../../user/guards/jwt-auth.guard.js';
import { CreateDto, UpdateDto } from '../dto/index.js';
import { CrudService } from '../providers/index.js';

/**
 * route /crud/*
 *
 * AF-554: 脚手架 demo 的第二道门禁 —— 即使 ENABLE_SAMPLE_API=true 显式开启，
 * 也必须 JWT + admin 角色才可写；生产环境模块本身不会挂载。
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('crud')
export class CrudController {
  constructor(private crud: CrudService) {}

  @Get(':id') // GET http://localhost:3000/test/crud/:id
  public async read(@Param('id', ParseIntPipe) id: number): Promise<Sampletable1> {
    const result = await this.crud.read(id);
    if (!result) {
      throw new NotFoundException('NotFoundData');
    }

    return result;
  }

  @Post() // POST http://localhost:3000/test/crud
  public async create(@Body() body: CreateDto): Promise<{ id: number }> {
    const result = await this.crud.create(body);
    if (!result.id) {
      throw new InternalServerErrorException('NotCreatedData');
    }

    return { id: result.id };
  }

  @Put(':id') // PUT http://localhost:3000/test/crud/:id
  public async update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateDto): Promise<{ success: boolean }> {
    const result = await this.crud.update(id, body);

    return { success: !!result.affected };
  }

  @Delete(':id') // DELETE http://localhost:3000/test/crud/:id
  public async remove(@Param('id', ParseIntPipe) id: number): Promise<{ success: boolean }> {
    const result = await this.crud.remove(id);

    return { success: !!result.affected };
  }
}
