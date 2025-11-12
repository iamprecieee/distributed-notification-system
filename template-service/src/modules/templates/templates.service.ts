import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { TemplatesRepository } from "./templates.repository";
import { RedisService } from "../../common/redis/redis.service";
import { RabbitMQService } from "../../common/messaging/rabbitmq.service";
import { Template } from "./entities/template.entity";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { UpdateTemplateDto } from "./dto/update-template.dto";
import { validateVariables } from "./utils/extract-placeholders.util";

type PaginatedResponse = {
  data: Template[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly CACHE_TTL = 3600;
  private readonly CACHE_PREFIX = "template";

  constructor(
    private readonly repository: TemplatesRepository,
    private readonly redisService: RedisService,
    private readonly rabbitmqService: RabbitMQService
  ) {}

  async create(dto: CreateTemplateDto): Promise<Template> {
    const validation = validateVariables(dto.content, dto.variables);

    if (!validation.isValid) {
      throw new BadRequestException(
        `Variable validation failed: Missing variables [${validation.missingVariables.join(
          ", "
        )}] found in content placeholders`
      );
    }

    if (validation.unusedVariables.length > 0) {
      this.logger.warn(
        `Template '${
          dto.code
        }' declares unused variables: [${validation.unusedVariables.join(
          ", "
        )}]`
      );
    }

    const exists = await this.repository.exists(dto.code, dto.language);
    if (exists) {
      throw new BadRequestException(
        `Template with code '${dto.code}' and language '${dto.language}' already exists`
      );
    }

    const template = await this.repository.create({
      ...dto,
      version: 1,
    });

    this.logger.log(
      `Created template: ${template.code} v${template.version} (language: ${template.language})`
    );

    await this.cacheTemplate(template);

    await this.publishUpdate(template.code, template.version);

    return template;
  }

  async update(code: string, dto: UpdateTemplateDto): Promise<Template> {
    const language = dto.language ?? "en";

    const latest = await this.repository.findByCodeAndLanguage(code, language);

    if (!latest) {
      throw new NotFoundException(
        `Template '${code}' not found for language '${language}'`
      );
    }

    const updatedContent = dto.content ?? latest.content;
    const updatedVariables = dto.variables ?? latest.variables;

    const validation = validateVariables(updatedContent, updatedVariables);

    if (!validation.isValid) {
      throw new BadRequestException(
        `Variable validation failed: Missing variables [${validation.missingVariables.join(
          ", "
        )}] found in content placeholders`
      );
    }

    if (validation.unusedVariables.length > 0) {
      this.logger.warn(
        `Template '${code}' v${
          latest.version + 1
        } declares unused variables: [${validation.unusedVariables.join(", ")}]`
      );
    }

    const nextVersion = latest.version + 1;

    const template = await this.repository.create({
      code: latest.code,
      type: dto.type ?? latest.type,
      language,
      content: updatedContent,
      variables: updatedVariables,
      version: nextVersion,
    });

    this.logger.log(
      `Updated template: ${template.code} v${template.version} (language: ${template.language})`
    );

    await this.invalidateCache(code, language);

    await this.cacheTemplate(template);

    await this.publishUpdate(template.code, template.version);

    return template;
  }

  async findOne(
    code: string,
    language: string,
    version?: number
  ): Promise<Template> {
    const cacheKey = this.getCacheKey(code, language, version ?? "latest");

    const startTime = Date.now();
    const cached = await this.redisService.get<Template>(cacheKey);
    const cacheLatency = Date.now() - startTime;

    if (cached) {
      this.logger.debug(`[CACHE_HIT] ${cacheKey} (latency: ${cacheLatency}ms)`);
      return cached;
    }

    this.logger.debug(`[CACHE_MISS] ${cacheKey} (latency: ${cacheLatency}ms)`);

    const dbStartTime = Date.now();
    const template = await this.repository.findByCodeAndLanguage(
      code,
      language,
      version
    );
    const dbLatency = Date.now() - dbStartTime;

    if (!template) {
      throw new NotFoundException(
        `Template '${code}' not found for language '${language}'${
          version ? ` version ${version}` : ""
        }`
      );
    }

    this.logger.log(
      `[DB_FETCH] ${code} v${template.version} (language: ${language}, latency: ${dbLatency}ms)`
    );

    await this.cacheTemplate(template);

    return template;
  }

  async findAll(page: number, limit: number): Promise<PaginatedResponse> {
    const [data, total] = await this.repository.findAll(page, limit);

    this.logger.debug(
      `[LIST] Retrieved ${data.length} templates (page: ${page}, limit: ${limit}, total: ${total})`
    );

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async delete(code: string, language: string): Promise<void> {
    const template = await this.repository.findByCodeAndLanguage(
      code,
      language
    );

    if (!template) {
      throw new NotFoundException(
        `Template '${code}' not found for language '${language}'`
      );
    }

    await this.invalidateCache(code, language);

    this.logger.log(
      `Deleted template: ${code} (language: ${language}) - cache invalidated`
    );
  }

  private getCacheKey(
    code: string,
    language: string,
    version: number | string
  ): string {
    return `${this.CACHE_PREFIX}:${code}:${language}:${version}`;
  }

  private async cacheTemplate(template: Template): Promise<void> {
    const keyLatest = this.getCacheKey(
      template.code,
      template.language,
      "latest"
    );
    const keyVersioned = this.getCacheKey(
      template.code,
      template.language,
      template.version
    );

    await Promise.all([
      this.redisService.set(keyLatest, template, this.CACHE_TTL),
      this.redisService.set(keyVersioned, template, this.CACHE_TTL),
    ]);

    this.logger.debug(
      `[CACHE_SET] ${template.code} v${template.version} (language: ${template.language}, TTL: ${this.CACHE_TTL}s)`
    );
  }

  private async invalidateCache(code: string, language: string): Promise<void> {
    const pattern = `${this.CACHE_PREFIX}:${code}:${language}:*`;
    const keys = await this.redisService.keys(pattern);

    if (keys.length === 0) {
      this.logger.debug(
        `[CACHE_INVALIDATE] No keys found for pattern: ${pattern}`
      );
      return;
    }

    await Promise.all(keys.map((key) => this.redisService.del(key)));

    this.logger.log(
      `[CACHE_INVALIDATE] Deleted ${keys.length} cache key(s) for: ${code} (language: ${language})`
    );
  }

  private async publishUpdate(code: string, version: number): Promise<void> {
    try {
      await this.rabbitmqService.publishTemplateUpdated(code, version);
      this.logger.debug(
        `[EVENT_PUBLISHED] template.updated: ${code} v${version}`
      );
    } catch (error) {
      this.logger.error(
        `[EVENT_FAILED] Failed to publish update event: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}
