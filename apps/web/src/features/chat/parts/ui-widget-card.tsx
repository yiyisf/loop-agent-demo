import type { UiBlock, UiWidget } from '@loop-agent/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function formatUiSelection(widget: UiWidget, payload: Record<string, string>): string {
  switch (widget.kind) {
    case 'choice': {
      const labels = widget.options
        .filter((o) => payload.ids?.split(',').includes(o.id))
        .map((o) => o.label);
      return `我选择：${labels.join('、') || payload.ids}`;
    }
    case 'table': {
      const idx = Number(payload.row);
      const row = widget.rows[idx];
      if (!row) return '查看行：';
      const cells = widget.columns.map((col, i) => `${col}=${row[i] ?? ''}`).join('，');
      return `查看行：${cells}`;
    }
    case 'metric': {
      const item = widget.items.find((i) => i.label === payload.label);
      return item ? `查看指标：${item.label} ${item.value}` : `查看指标：${payload.label}`;
    }
    case 'form': {
      const title = widget.title ?? '表单';
      const lines = widget.fields
        .map((f) => `${f.label}：${(payload[f.name] ?? '').trim() || '（空）'}`)
        .join('\n');
      return `表单「${title}」：\n${lines}`;
    }
  }
}

export function UiWidgetCard({
  block,
  interactive,
  onPick,
}: {
  block: UiBlock;
  interactive: boolean;
  onPick?: (text: string) => void;
}) {
  const { widget } = block;
  return (
    <div
      data-testid={`ui-${widget.kind}`}
      className="rounded-md border bg-card px-3 py-2.5 text-sm"
    >
      {widget.title ? <p className="mb-1.5 text-sm font-medium">{widget.title}</p> : null}
      {widget.kind === 'table' && (
        <TableWidget widget={widget} interactive={interactive} onPick={onPick} />
      )}
      {widget.kind === 'choice' && (
        <ChoiceWidget widget={widget} interactive={interactive} onPick={onPick} />
      )}
      {widget.kind === 'metric' && (
        <MetricWidget widget={widget} interactive={interactive} onPick={onPick} />
      )}
      {widget.kind === 'form' && (
        <FormWidget widget={widget} interactive={interactive} onPick={onPick} />
      )}
    </div>
  );
}

function TableWidget({
  widget,
  interactive,
  onPick,
}: {
  widget: Extract<UiWidget, { kind: 'table' }>;
  interactive: boolean;
  onPick?: (text: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b">
            {widget.columns.map((col) => (
              <th key={col} className="px-2 py-1 font-medium">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {widget.rows.map((row) => (
            <tr key={row.join('\u0001')} className="border-b last:border-0">
              {row.map((cell, j) => (
                <td key={`${widget.columns[j] ?? cell}:${cell}`} className="px-2 py-1">
                  {interactive && onPick && j === 0 ? (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline"
                      onClick={() =>
                        onPick(
                          formatUiSelection(widget, {
                            row: String(widget.rows.indexOf(row)),
                          }),
                        )
                      }
                    >
                      {cell}
                    </button>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChoiceWidget({
  widget,
  interactive,
  onPick,
}: {
  widget: Extract<UiWidget, { kind: 'choice' }>;
  interactive: boolean;
  onPick?: (text: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => {
    setPicked((prev) =>
      widget.multiple ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id],
    );
  };
  const submit = () => {
    if (!onPick || picked.length === 0) return;
    onPick(formatUiSelection(widget, { ids: picked.join(',') }));
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{widget.prompt}</p>
      <ul className="grid gap-1.5">
        {widget.options.map((opt) => {
          const active = picked.includes(opt.id);
          return (
            <li key={opt.id}>
              <button
                type="button"
                disabled={!interactive}
                onClick={() => {
                  if (widget.multiple) toggle(opt.id);
                  else onPick?.(formatUiSelection(widget, { ids: opt.id }));
                }}
                className={cn(
                  'w-full rounded-md border px-2.5 py-1.5 text-left text-sm disabled:opacity-60',
                  interactive && 'hover:bg-accent/60',
                  active && 'border-foreground/30 bg-accent/40',
                )}
              >
                <span className="font-medium">{opt.label}</span>
                {opt.description ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {widget.multiple && interactive ? (
        <Button type="button" size="sm" disabled={picked.length === 0} onClick={submit}>
          确认选择
        </Button>
      ) : null}
    </div>
  );
}

function MetricWidget({
  widget,
  interactive,
  onPick,
}: {
  widget: Extract<UiWidget, { kind: 'metric' }>;
  interactive: boolean;
  onPick?: (text: string) => void;
}) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2">
      {widget.items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            disabled={!interactive}
            onClick={() => onPick?.(formatUiSelection(widget, { label: item.label }))}
            className={cn(
              'w-full rounded-md border px-2.5 py-2 text-left disabled:opacity-60',
              interactive && 'hover:bg-accent/60',
            )}
          >
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-base font-medium">{item.value}</p>
            {item.hint ? <p className="text-xs text-muted-foreground">{item.hint}</p> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function FormWidget({
  widget,
  interactive,
  onPick,
}: {
  widget: Extract<UiWidget, { kind: 'form' }>;
  interactive: boolean;
  onPick?: (text: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value }));
  const missing = widget.fields.some((f) => f.required && !(values[f.name] ?? '').trim());

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!interactive || missing) return;
        onPick?.(formatUiSelection(widget, values));
      }}
    >
      {widget.prompt ? <p className="text-xs text-muted-foreground">{widget.prompt}</p> : null}
      {widget.fields.map((field) => {
        const fieldId = `ui-field-${field.name}`;
        return (
          <div key={field.name} className="grid gap-1 text-xs">
            <label htmlFor={fieldId} className="text-muted-foreground">
              {field.label}
              {field.required ? ' *' : ''}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={fieldId}
                name={field.name}
                disabled={!interactive}
                value={values[field.name] ?? ''}
                onChange={(e) => set(field.name, e.target.value)}
                rows={3}
                className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              />
            ) : field.type === 'select' ? (
              <select
                id={fieldId}
                name={field.name}
                disabled={!interactive}
                value={values[field.name] ?? ''}
                onChange={(e) => set(field.name, e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">请选择</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={fieldId}
                name={field.name}
                type="text"
                disabled={!interactive}
                value={values[field.name] ?? ''}
                onChange={(e) => set(field.name, e.target.value)}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              />
            )}
          </div>
        );
      })}
      {interactive ? (
        <Button type="submit" size="sm" disabled={missing}>
          提交
        </Button>
      ) : null}
    </form>
  );
}
