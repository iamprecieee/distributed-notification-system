import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { TemplatesService } from "./templates.service";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { UpdateTemplateDto } from "./dto/update-template.dto";
import { GetTemplateQueryDto } from "./dto/get-template-query.dto";
import { PaginationQueryDto } from "./dto/pagination-query.dto";
import { Template } from "./entities/template.entity";
import { CreateTemplateDoc } from "./docs/create-template.doc";
import { UpdateTemplateDoc } from "./docs/update-template.doc";
import { GetTemplateDoc } from "./docs/get-template.doc";
import { GetTemplatesDoc } from "./docs/get-templates.doc";
import { DeleteTemplateDoc } from "./docs/delete-template.doc";

@ApiTags("Templates")
@Controller("api/v1/templates")
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @CreateTemplateDoc()
  async create(@Body() dto: CreateTemplateDto): Promise<Template> {
    return await this.templatesService.create(dto);
  }

  @Put(":code")
  @UpdateTemplateDoc()
  async update(
    @Param("code") code: string,
    @Body() dto: UpdateTemplateDto
  ): Promise<Template> {
    return await this.templatesService.update(code, dto);
  }

  @Get(":code")
  @GetTemplateDoc()
  async findOne(
    @Param("code") code: string,
    @Query() query: GetTemplateQueryDto
  ): Promise<Template> {
    return await this.templatesService.findOne(
      code,
      query.lang ?? "en",
      query.version
    );
  }

  @Get()
  @GetTemplatesDoc()
  async findAll(@Query() query: PaginationQueryDto): Promise<{
    data: Template[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return await this.templatesService.findAll(
      query.page ?? 1,
      query.limit ?? 10
    );
  }

  @Delete(":code")
  @HttpCode(HttpStatus.NO_CONTENT)
  @DeleteTemplateDoc()
  async delete(
    @Param("code") code: string,
    @Query("lang") lang: string = "en"
  ): Promise<void> {
    await this.templatesService.delete(code, lang);
  }
}
