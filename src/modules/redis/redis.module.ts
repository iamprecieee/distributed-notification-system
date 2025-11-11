import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';
import { LoggerModule } from 'nestjs-pino';

@Global()
@Module({
  imports: [LoggerModule.forRoot()],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
