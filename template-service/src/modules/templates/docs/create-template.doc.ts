import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiBody } from "@nestjs/swagger";

export function CreateTemplateDoc() {
  return applyDecorators(
    ApiOperation({
      summary: "Create a new template",
      description:
        "Creates a new template with version 1. Template code and language combination must be unique.",
    }),
    ApiBody({
      schema: {
        type: "object",
        required: ["code", "type", "language", "content", "variables"],
        properties: {
          code: {
            type: "string",
            example: "welcome_notification",
            description: "Unique template code identifier",
          },
          type: {
            type: "string",
            enum: ["email", "push"],
            example: "push",
            description: "Template type",
          },
          language: {
            type: "string",
            example: "en",
            description: "Template language code (ISO 639-1)",
          },
          content: {
            type: "object",
            example: {
              title: "Welcome {{name}}!",
              body: "Hi {{name}}, click {{link}} to begin.",
            },
            description:
              "Template content with placeholders using {{variable}} syntax",
          },
          variables: {
            type: "array",
            items: { type: "string" },
            example: ["name", "link"],
            description: "List of variables used in the template content",
          },
        },
      },
    }),
    ApiResponse({
      status: 201,
      description: "Template created successfully",
      schema: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          code: { type: "string", example: "welcome_notification" },
          type: { type: "string", example: "push" },
          language: { type: "string", example: "en" },
          version: { type: "number", example: 1 },
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
      status: 400,
      description: "Bad request - validation failed or template already exists",
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 400 },
          message: {
            type: "string",
            example:
              "Variable validation failed: Missing variables [link, code] found in content placeholders",
          },
          path: { type: "string", example: "/api/v1/templates" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
    })
  );
}
