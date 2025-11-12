import { Exclude } from 'class-transformer';
import { UserPreference } from '../../../common/types/user-preference.enum';

export class UserResponseDto {
  id: string;
  name: string;
  email: string;
  push_token: string | null;
  preferences: UserPreference;
  created_at: Date;
  updated_at: Date;

  @Exclude()
  password_hash: string;

  constructor(partial: Partial<UserResponseDto>) {
    Object.assign(this, partial);
  }
}
