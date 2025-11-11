import {
  IsString,
  IsEmail,
  IsOptional,
  IsBoolean,
  MinLength,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class UserPreferenceDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable email notifications',
  })
  @IsBoolean()
  email: boolean;

  @ApiProperty({
    example: true,
    description: 'Enable/disable push notifications',
  })
  @IsBoolean()
  push: boolean;
}

export class CreateUserDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the user',
    minLength: 1,
    maxLength: 255,
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Unique email address',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    example: 'fcm_token_ABC123XYZ',
    description: 'Firebase Cloud Messaging token for push notifications',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  push_token?: string | null;

  @ApiProperty({
    description: 'User notification preferences',
    type: UserPreferenceDto,
  })
  @ValidateNested()
  @Type(() => UserPreferenceDto)
  preferences: UserPreferenceDto;

  @ApiProperty({
    example: 'SecurePass123!',
    description: 'User password (minimum 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password: string;
}
