import { z } from 'zod';

export const UiTableWidgetSchema = z.object({
  kind: z.literal('table'),
  title: z.string().trim().max(80).optional(),
  columns: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  rows: z
    .array(z.array(z.string().max(200)).min(1).max(8))
    .min(1)
    .max(40),
});

export const UiChoiceOptionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
});

export const UiChoiceWidgetSchema = z.object({
  kind: z.literal('choice'),
  title: z.string().trim().max(80).optional(),
  prompt: z.string().trim().min(1).max(240),
  options: z.array(UiChoiceOptionSchema).min(1).max(8),
  multiple: z.boolean().optional(),
});

export const UiMetricItemSchema = z.object({
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(40),
  hint: z.string().trim().max(80).optional(),
});

export const UiMetricWidgetSchema = z.object({
  kind: z.literal('metric'),
  title: z.string().trim().max(80).optional(),
  items: z.array(UiMetricItemSchema).min(1).max(8),
});

export const UiFormFieldSchema = z.object({
  name: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'textarea', 'select']),
  options: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  required: z.boolean().optional(),
});

export const UiFormWidgetSchema = z.object({
  kind: z.literal('form'),
  title: z.string().trim().max(80).optional(),
  prompt: z.string().trim().max(240).optional(),
  fields: z.array(UiFormFieldSchema).min(1).max(8),
});

export const UiWidgetSchema = z.discriminatedUnion('kind', [
  UiTableWidgetSchema,
  UiChoiceWidgetSchema,
  UiMetricWidgetSchema,
  UiFormWidgetSchema,
]);
export type UiWidget = z.infer<typeof UiWidgetSchema>;

export const UiBlockSchema = z.object({
  id: z.string(),
  widget: UiWidgetSchema,
});
export type UiBlock = z.infer<typeof UiBlockSchema>;
