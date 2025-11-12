import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam, ApiQuery } from "@nestjs/swagger";

export function GetTemplateDoc() {
  return applyDecorators(
    ApiOperation({
      summary: "Get a template by code",
      description:
        "Retrieves a template by code and language. Returns the latest version by default or a specific version if provided.",
    }),
    ApiParam({
      name: "code",
      type: "string",
      example: "welcome_notification",
      description: "Template code",
    }),
    ApiQuery({
      name: "lang",
      type: "string",
      required: false,
      example: "en",
      description: "Language code (default: en)",
    }),
    ApiQuery({
      name: "version",
      type: "number",
      required: false,
      example: 2,
      description: "Specific version number (default: latest)",
    }),
    ApiResponse({
      status: 200,
      description: "Template retrieved successfully",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string", example: "welcome_notification" },
          type: { type: "string", example: "push" },
          language: { type: "string", example: "en" },
          version: { type: "number", example: 2 },
          content: {
            type: "object",
            example: {
              title: "Welcome {{name}}!",
              body: "Hi {{name}}, click {{link}} to begin.",
            },
          },
          variables: {
            type: "array",
            items: { type: "string" },
            example: ["name", "link"],
          },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: "Template not found",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 404 },
          message: {
            type: "string",
            example:
              "Template 'welcome_notification' not found for language 'en'",
          },
        },
      },
    })
  );
}
