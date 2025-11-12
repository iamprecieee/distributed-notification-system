import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class CreateTemplateTable1234567890123 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "templates",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "code",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "type",
            type: "enum",
            enum: ["email", "push"],
            isNullable: false,
          },
          {
            name: "language",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "version",
            type: "int",
            isNullable: false,
          },
          {
            name: "content",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "variables",
            type: "jsonb",
            isNullable: false,
          },
          {
            name: "created_at",
            type: "timestamp with time zone",
            default: "now()",
          },
          {
            name: "updated_at",
            type: "timestamp with time zone",
            default: "now()",
          },
        ],
      }),
      true
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("templates");
  }
}
