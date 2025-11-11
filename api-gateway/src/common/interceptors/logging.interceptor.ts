import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, headers } = request;
    const userAgent = headers['user-agent'] || '';
    const startTime = Date.now();

    const requestId =
      headers['x-request-id'] ||
      headers['x-correlation-id'] ||
      `req-${Date.now()}`;

    this.logger.log(
      `➡️  ${method} ${url} - User-Agent: ${userAgent} - RequestId: ${requestId}`
    );

    if (Object.keys(body || {}).length > 0) {
      this.logger.debug(`Request Body: ${JSON.stringify(body)}`);
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const responseTime = Date.now() - startTime;

          this.logger.log(
            `⬅️  ${method} ${url} - ${statusCode} - ${responseTime}ms - RequestId: ${requestId}`
          );
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;
          this.logger.error(
            `❌ ${method} ${url} - Error: ${error.message} - ${responseTime}ms - RequestId: ${requestId}`
          );
        },
      })
    );
  }
}
