import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import { TemplateVariables } from 'src/common/interfaces/index.interface';

interface TemplateResponse {
  data: {
    content: string;
  };
}

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private templateCache: Map<string, string> = new Map();

  constructor(private httpService: HttpService) {}

  async getTemplate(templateCode: string): Promise<string> {
    // Check cache first
    if (this.templateCache.has(templateCode)) {
      const cached = this.templateCache.get(templateCode);
      if (cached) return cached;
    }

    const templateServiceUrl =
      process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3004';

    const response: AxiosResponse<TemplateResponse> = await firstValueFrom(
      this.httpService.get<TemplateResponse>(
        `${templateServiceUrl}/api/v1/templates/${templateCode}`,
      ),
    );

    const template = response.data.data.content;

    // Cache the template
    this.templateCache.set(templateCode, template);

    return template;
  }

  renderTemplate(template: string, variables: TemplateVariables): string {
    let rendered = template;
    Object.keys(variables).forEach((key) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      const value = variables[key];
      const stringValue =
        value !== null && value !== undefined ? String(value) : '';
      rendered = rendered.replace(regex, stringValue);
    });
    return rendered;
  }

  clearCache(): void {
    this.templateCache.clear();
  }
}
