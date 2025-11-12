import {
  IsString,
  IsEnum,
  IsObject,
  IsArray,
  IsOptional,
  MinLength,
} from "class-validator";
import { TemplateType } from "../enums/template-type.enum";

export class UpdateTemplateDto {
  @IsOptional()
  @IsEnum(TemplateType)
  type?: TemplateType;

  @IsOptional()
  @IsString()
  @MinLength(2)
  language?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  variables?: string[];
}
