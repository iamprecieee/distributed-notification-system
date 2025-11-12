import { applyDecorators } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiParam, ApiQuery } from "@nestjs/swagger";

export function DeleteTemplateDoc() {
  return applyDecorators(
    ApiOperation({
      summary: "Delete a template",
      description:
        "Soft deletes a template and invalidates its cache. All versions for the given code and language are affected.",
    }),
    ApiParam({
      name: "code",
      type: "string",
      example: "welcome_notification",
      description: "Template code to delete",
    }),
    ApiQuery({
      name: "lang",
      type: "string",
      required: false,
      example: "en",
      description: "Language code (default: en)",
    }),
    ApiResponse({
      status: 204,
      description: "Template deleted successfully",
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
