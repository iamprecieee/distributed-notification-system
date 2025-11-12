import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";
import { TemplatesRepository } from "./templates.repository";
import { Template } from "./entities/template.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Template])],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplatesRepository],
  exports: [TemplatesService],
})
export class TemplatesModule {}
