import type { Plan, StepDraft } from '@loop-agent/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ClipboardCheck, Play, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, queryKeys } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRunStore } from '@/stores/run-store';

export interface PlanEditorProps {
  runId: string;
  plan: Plan;
}

type Draft = StepDraft & { key: string };

function toDrafts(plan: Plan): Draft[] {
  return plan.steps.map((s) => ({
    key: s.id,
    id: s.id,
    title: s.title,
    goal: s.goal,
    acceptance: s.acceptance,
    dependsOn: [...s.dependsOn],
    tools: [...s.tools],
  }));
}

function stripKeys(drafts: Draft[]): StepDraft[] {
  return drafts.map(({ key: _key, ...rest }) => rest);
}

export function isUnchanged(plan: Plan, objective: string, drafts: Draft[]): boolean {
  if (objective.trim() !== plan.objective) return false;
  if (drafts.length !== plan.steps.length) return false;
  return drafts.every((d, i) => {
    const s = plan.steps[i]!;
    return (
      d.id === s.id &&
      d.title === s.title &&
      d.goal === s.goal &&
      d.acceptance === s.acceptance &&
      d.dependsOn.join(',') === s.dependsOn.join(',') &&
      d.tools.join(',') === s.tools.join(',')
    );
  });
}

export function validateDrafts(drafts: Draft[]): string | null {
  if (drafts.length === 0) return '至少需要一个步骤';
  const ids = new Set<string>();
  for (const d of drafts) {
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(d.id))
      return `步骤 ID「${d.id}」只能包含小写字母、数字、- 和 _`;
    if (ids.has(d.id)) return `步骤 ID「${d.id}」重复`;
    ids.add(d.id);
    if (!d.title.trim()) return `步骤「${d.id}」缺少标题`;
    if (!d.goal.trim()) return `步骤「${d.id}」缺少目标`;
    if (!d.acceptance.trim()) return `步骤「${d.id}」缺少验收标准`;
  }
  for (const d of drafts) {
    for (const dep of d.dependsOn) {
      if (!ids.has(dep)) return `步骤「${d.id}」依赖了不存在的步骤「${dep}」`;
      if (dep === d.id) return `步骤「${d.id}」不能依赖自己`;
    }
  }
  return null;
}

/**
 * Shown while a plan_first run waits for confirmation: the user may reorder,
 * edit, add or remove steps before execution starts.
 */
export function PlanEditor({ runId, plan }: PlanEditorProps) {
  const pushNotice = useRunStore((s) => s.pushNotice);
  const [objective, setObjective] = useState(plan.objective);
  const [drafts, setDrafts] = useState<Draft[]>(() => toDrafts(plan));
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const tools = useQuery({
    queryKey: queryKeys.tools,
    queryFn: api.listTools,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const toolOptions = useMemo(
    () => (tools.data ?? []).filter((t) => t.enabled && t.category !== 'control'),
    [tools.data],
  );

  const unchanged = isUnchanged(plan, objective, drafts);
  const error = validateDrafts(drafts);

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const move = (index: number, delta: number) =>
    setDrafts((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return list;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const remove = (key: string) =>
    setDrafts((list) => {
      const removed = list.find((d) => d.key === key);
      return list
        .filter((d) => d.key !== key)
        .map((d) => ({ ...d, dependsOn: d.dependsOn.filter((id) => id !== removed?.id) }));
    });

  const add = () =>
    setDrafts((list) => {
      let n = list.length + 1;
      while (list.some((d) => d.id === `step-${n}`)) n += 1;
      const prev = list.at(-1);
      return [
        ...list,
        {
          key: `new-${Date.now()}-${n}`,
          id: `step-${n}`,
          title: '',
          goal: '',
          acceptance: '',
          dependsOn: prev ? [prev.id] : [],
          tools: [],
        },
      ];
    });

  const toggle = (key: string, field: 'tools' | 'dependsOn', value: string) =>
    setDrafts((list) =>
      list.map((d) => {
        if (d.key !== key) return d;
        const has = d[field].includes(value);
        return { ...d, [field]: has ? d[field].filter((v) => v !== value) : [...d[field], value] };
      }),
    );

  const submit = async () => {
    if (error) {
      pushNotice('warn', error);
      return;
    }
    setBusy('confirm');
    try {
      await api.confirmPlan(
        runId,
        unchanged
          ? { action: 'confirm' }
          : { action: 'edit', objective: objective.trim(), steps: stripKeys(drafts) },
      );
    } catch (err) {
      pushNotice('error', err instanceof Error ? err.message : '提交计划失败');
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    try {
      await api.confirmPlan(runId, { action: 'cancel', reason: '用户取消了计划' });
    } catch (err) {
      pushNotice('error', err instanceof Error ? err.message : '取消失败');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-primary/40 bg-card text-sm shadow-sm ring-2 ring-primary/10">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <ClipboardCheck className="size-4 shrink-0 text-primary" />
        <span className="font-medium">确认计划</span>
        <Badge variant="secondary">v{plan.revision}</Badge>
        {!unchanged && <Badge variant="warning">已修改</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          可编辑、排序或删除步骤，确认后开始执行
        </span>
      </div>

      <div className="grid gap-3 border-t px-3 py-3">
        <div className="grid gap-1 text-xs text-muted-foreground">
          <label htmlFor={`plan-${runId}-objective`}>目标</label>
          <Textarea
            id={`plan-${runId}-objective`}
            name="plan-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            className="min-h-0 text-sm text-foreground"
          />
        </div>

        <ol className="grid gap-2">
          {drafts.map((d, index) => (
            <li key={d.key} className="rounded-lg border bg-background/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
                  {index + 1}
                </span>
                <input
                  type="text"
                  name={`step-${d.key}-title`}
                  value={d.title}
                  onChange={(e) => update(d.key, { title: e.target.value })}
                  placeholder="步骤标题"
                  aria-label="步骤标题"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <input
                  type="text"
                  name={`step-${d.key}-id`}
                  value={d.id}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setDrafts((list) =>
                      list.map((x) =>
                        x.key === d.key
                          ? { ...x, id: nextId }
                          : {
                              ...x,
                              dependsOn: x.dependsOn.map((id) => (id === d.id ? nextId : id)),
                            },
                      ),
                    );
                  }}
                  aria-label="步骤 ID"
                  title="步骤 ID"
                  className="h-8 w-28 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <div className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="上移"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下移"
                    disabled={index === drafts.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除步骤"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => remove(d.key)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="grid gap-1 text-[11px] text-muted-foreground">
                  <label htmlFor={`step-${d.key}-goal`}>目标</label>
                  <Textarea
                    id={`step-${d.key}-goal`}
                    name={`step-${d.key}-goal`}
                    value={d.goal}
                    onChange={(e) => update(d.key, { goal: e.target.value })}
                    rows={2}
                    className="min-h-0 text-xs text-foreground"
                  />
                </div>
                <div className="grid gap-1 text-[11px] text-muted-foreground">
                  <label htmlFor={`step-${d.key}-acceptance`}>验收标准</label>
                  <Textarea
                    id={`step-${d.key}-acceptance`}
                    name={`step-${d.key}-acceptance`}
                    value={d.acceptance}
                    onChange={(e) => update(d.key, { acceptance: e.target.value })}
                    rows={2}
                    className="min-h-0 text-xs text-foreground"
                  />
                </div>
              </div>

              <div className="mt-2 grid gap-1.5 text-[11px] text-muted-foreground">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1">依赖：</span>
                  {drafts.filter((o) => o.key !== d.key).length === 0 && <span>无</span>}
                  {drafts
                    .filter((o) => o.key !== d.key)
                    .map((o) => (
                      <ToggleChip
                        key={o.key}
                        active={d.dependsOn.includes(o.id)}
                        onClick={() => toggle(d.key, 'dependsOn', o.id)}
                      >
                        {o.id}
                      </ToggleChip>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1">工具：</span>
                  {toolOptions.length === 0 && <span>无可用工具</span>}
                  {toolOptions.map((t) => (
                    <ToggleChip
                      key={t.name}
                      active={d.tools.includes(t.name)}
                      title={t.description}
                      onClick={() => toggle(d.key, 'tools', t.name)}
                    >
                      {t.name}
                      {t.risk !== 'low' && <span className="ml-0.5 text-warning">•</span>}
                    </ToggleChip>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus /> 添加步骤
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={cancel}
            >
              <X /> 取消任务
            </Button>
            <Button type="button" size="sm" disabled={busy !== null || !!error} onClick={submit}>
              <Play /> {unchanged ? '开始执行' : '按修改后的计划执行'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
