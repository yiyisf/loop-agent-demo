import type {
  LoopAgentDataParts,
  LoopAgentMessageMetadata,
  Run,
  RunSnapshot as SharedRunSnapshot,
  Thread,
} from '@loop-agent/shared';
import type { UIMessage } from 'ai';

export type AgentUIMessage = UIMessage<LoopAgentMessageMetadata, LoopAgentDataParts>;
export type AgentPart = AgentUIMessage['parts'][number];

export type DataPart<K extends keyof LoopAgentDataParts> = Extract<
  AgentPart,
  { type: `data-${K}` }
>;

export interface ThreadListItem extends Thread {
  activeRunId: string | null;
}

export interface ThreadDetail {
  thread: ThreadListItem;
  messages: AgentUIMessage[];
  runs: Array<Pick<Run, 'id' | 'status' | 'createdAt' | 'endedAt'>>;
}

export type RunSnapshot = SharedRunSnapshot;

export interface ToolInfo {
  name: string;
  description: string;
  risk: 'low' | 'medium' | 'high';
  category: string;
  enabled: boolean;
  disabledReason?: string;
}

export interface ModelsInfo {
  provider: string;
  default: string;
  models: string[];
}
