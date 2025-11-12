import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { TemplateType } from "../enums/template-type.enum";

@Entity({ name: "templates" })
export class Template {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: false })
  code!: string;

  @Column({ type: "enum", enum: TemplateType })
  type!: TemplateType;

  @Column()
  language!: string;

  @Column()
  version!: number;

  @Column({ type: "jsonb" })
  content!: Record<string, unknown>;

  @Column({ type: "jsonb" })
  variables!: string[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
