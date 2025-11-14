import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TemplateService {
  private readonly logger = new Logger(TemplateService.name);
  private templateCache: Map<string, string> = new Map();

  constructor(private httpService: HttpService) {}

  async getTemplate(templateCode: string): Promise<string> {
    // Check cache first
    if (this.templateCache.has(templateCode)) {
      return this.templateCache.get(templateCode)!;
    }

    try {
      // Fetch from Template Service
      const templateServiceUrl = process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3004';
      const response = await firstValueFrom(
        this.httpService.get(`${templateServiceUrl}/api/v1/templates/${templateCode}`)
      );

      const template = response.data.data.content;
      
      // Cache the template
      this.templateCache.set(templateCode, template);
      
      return template;
    } catch (error) {
      this.logger.error(`Failed to fetch template: ${templateCode}`, error);
      
      // Return default template
      return this.getDefaultTemplate();
    }
  }

  renderTemplate(template: string, variables: Record<string, any>): string {
    let rendered = template;

    // Replace {{variable}} with actual values
    Object.keys(variables).forEach((key) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      rendered = rendered.replace(regex, variables[key] || '');
    });

    return rendered;
  }

  private getDefaultTemplate(): string {
    return `
      <html>
        <body>
          <h2>{{title}}</h2>
          <p>{{message}}</p>
          <p>{{name}}</p>
          <a href="{{link}}">Click here</a>
        </body>
      </html>
    `;
  }

  clearCache() {
    this.templateCache.clear();
  }
}
