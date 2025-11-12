import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiBody, ApiParam } from "@nestjs/swagger";

export function UpdateTemplateDoc() {
  return applyDecorators(
    ApiOperation({
      summary: "Update a template",
      description:
        "Creates a new version of an existing template by incrementing the version number. Original versions are preserved.",
    }),
    ApiParam({
      name: "code",
      type: "string",
      example: "welcome_notification",
      description: "Template code to update",
    }),
    ApiBody({
      schema: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["email", "push"],
            example: "push",
            description: "Template type (optional)",
          },
          language: {
            type: "string",
            example: "en",
            description: "Template language code (optional)",
          },
          content: {
            type: "object",
            example: {
              title: "Welcome {{name}}!",
              body: "Hello {{name}}, visit {{link}} now",
            },
            description: "Updated template content (optional)",
          },
          variables: {
            type: "array",
            items: { type: "string" },
            example: ["name", "link"],
            description: "Updated list of variables (optional)",
          },
        },
      },
    }),
    ApiResponse({
      status: 200,
      description: "Template updated successfully with new version",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string", example: "welcome_notification" },
          type: { type: "string", example: "push" },
          language: { type: "string", example: "en" },
          version: { type: "number", example: 2 },
          content: { type: "object" },
          variables: { type: "array", items: { type: "string" } },
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
            example: "Template 'welcome_notification' not found",
          },
        },
      },
    })
  );
}
