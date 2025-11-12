import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiQuery } from "@nestjs/swagger";

export function GetTemplatesDoc() {
  return applyDecorators(
    ApiOperation({
      summary: "Get all templates with pagination",
      description:
        "Retrieves a paginated list of all templates ordered by creation date (newest first).",
    }),
    ApiQuery({
      name: "page",
      type: "number",
      required: false,
      example: 1,
      description: "Page number (default: 1)",
    }),
    ApiQuery({
      name: "limit",
      type: "number",
      required: false,
      example: 10,
      description: "Items per page (default: 10, max: 100)",
    }),
    ApiResponse({
      status: 200,
      description: "Templates retrieved successfully",
      schema: {
        type: "object",
        properties: {
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                code: { type: "string", example: "welcome_notification" },
                type: { type: "string", example: "push" },
                language: { type: "string", example: "en" },
                version: { type: "number", example: 1 },
                content: { type: "object" },
                variables: { type: "array", items: { type: "string" } },
                created_at: { type: "string", format: "date-time" },
                updated_at: { type: "string", format: "date-time" },
              },
            },
          },
          meta: {
            type: "object",
            properties: {
              page: { type: "number", example: 1 },
              limit: { type: "number", example: 10 },
              total: { type: "number", example: 25 },
              totalPages: { type: "number", example: 3 },
            },
          },
        },
      },
    })
  );
}
