import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Template } from "./entities/template.entity";

@Injectable()
export class TemplatesRepository {
  constructor(
    @InjectRepository(Template)
    private readonly repository: Repository<Template>
  ) {}

  async create(template: Partial<Template>): Promise<Template> {
    const newTemplate = this.repository.create(template);
    return await this.repository.save(newTemplate);
  }

  async findByCodeAndLanguage(
    code: string,
    language: string,
    version?: number
  ): Promise<Template | null> {
    const query = this.repository
      .createQueryBuilder("template")
      .where("template.code = :code", { code })
      .andWhere("template.language = :language", { language });

    if (version) {
      query.andWhere("template.version = :version", { version });
    } else {
      query.orderBy("template.version", "DESC");
    }

    return await query.getOne();
  }

  async findLatestVersion(code: string, language: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder("template")
      .select("MAX(template.version)", "max")
      .where("template.code = :code", { code })
      .andWhere("template.language = :language", { language })
      .getRawOne<{ max: number | null }>();

    return result?.max ?? 0;
  }

  async findAll(page: number, limit: number): Promise<[Template[], number]> {
    const skip = (page - 1) * limit;

    return await this.repository.findAndCount({
      take: limit,
      skip,
      order: { created_at: "DESC" },
    });
  }

  async exists(code: string, language: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { code, language },
    });
    return count > 0;
  }
}
