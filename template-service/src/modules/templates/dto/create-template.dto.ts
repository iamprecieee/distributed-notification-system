import {
  IsString,
  IsEnum,
  IsObject,
  IsArray,
  MinLength,
} from "class-validator";
import { TemplateType } from "../enums/template-type.enum";

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsEnum(TemplateType)
  type!: TemplateType;

  @IsString()
  @MinLength(2)
  language!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsArray()
  @IsString({ each: true })
  variables!: string[];
}
