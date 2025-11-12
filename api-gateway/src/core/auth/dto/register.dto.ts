import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

class PreferencesDto {
  @ApiProperty({ example: true })
  email: boolean;

  @ApiProperty({ example: true })
  push: boolean;
}

export class RegisterDto {
  @ApiProperty({
    description: 'User full name',
    example: 'John Doe',
  })
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'User email address',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePass123!',
  })
  @IsNotEmpty()
  password: string;

  @ApiProperty({
    description: 'Push notification token',
    required: false,
    example: 'expo-push-token-123',
  })
  @IsOptional()
  push_token?: string;

  @ApiProperty({
    description: 'User preferences',
    required: false,
    type: PreferencesDto,
  })
  @IsOptional()
  @IsObject()
  preferences?: PreferencesDto;
}
