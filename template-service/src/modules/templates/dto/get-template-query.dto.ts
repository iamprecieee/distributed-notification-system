import { IsOptional, IsString, IsInt, Min } from "class-validator";
import { Type } from "class-transformer";

export class GetTemplateQueryDto {
  @IsOptional()
  @IsString()
  lang?: string = "en";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}
