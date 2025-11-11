import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUserData {
  user_id: string;
  email: string;
  iat?: number;
  exp?: number;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  }
);
