import type { AttachmentDraft, AttachmentPreview } from '@loop-agent/shared';

export const ATTACHMENT_MAX_FILES = 8;
export const ATTACHMENT_MAX_BYTES = 400_000;
export const ATTACHMENT_MAX_TEXT = 20_000;

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.html', '.xml']);
const TEXT_MIME = /^(text\/|application\/(json|xml|csv))/i;

export interface ExtractedAttachment {
  name: string;
  mime: string;
  size: number;
  text: string;
  truncated: boolean;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentError';
  }
}

export function isAllowedAttachment(name: string, mime: string): boolean {
  const ext = extname(name);
  if (ext === '.pdf' || mime === 'application/pdf') return true;
  if (TEXT_EXT.has(ext) || TEXT_MIME.test(mime)) return true;
  return false;
}

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function safeFileName(name: string): string {
  const base = name.replace(/[/\\]+/g, '_').replace(/^\.+/, '') || 'file';
  return base.slice(0, 120);
}

export function unescapePdfString(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\([()\\])/g, '$1')
    .replace(/\\(\d{1,3})/g, (_, n: string) => String.fromCharCode(Number.parseInt(n, 8)));
}

/** Best-effort text from simple (uncompressed) PDFs. Scanned pages return empty. */
export function extractPdfText(data: Uint8Array): string {
  const src = Buffer.from(data).toString('latin1');
  const parts: string[] = [];
  const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tj.exec(src))) parts.push(unescapePdfString(m[1] ?? ''));
  const arr = /\[(.*?)\]\s*TJ/gs;
  while ((m = arr.exec(src))) {
    const inner = m[1] ?? '';
    const strs = inner.matchAll(/\(((?:\\.|[^\\)])*)\)/g);
    for (const s of strs) parts.push(unescapePdfString(s[1] ?? ''));
  }
  return parts.join(' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeBase64(dataBase64: string): Buffer {
  const cleaned = dataBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.length === 0) throw new AttachmentError('附件内容为空');
  return buf;
}

export function extractOne(draft: AttachmentDraft): ExtractedAttachment {
  const name = safeFileName(draft.name);
  const mime = draft.mime || 'application/octet-stream';
  if (!isAllowedAttachment(name, mime)) {
    throw new AttachmentError(`不支持的文件类型：${name}（仅文本、Markdown、JSON、CSV、小 PDF）`);
  }

  let raw: string;
  let size: number;
  const isPdf = extname(name) === '.pdf' || mime === 'application/pdf';

  if (isPdf) {
    if (!draft.dataBase64) throw new AttachmentError(`PDF「${name}」需要以二进制上传`);
    const buf = decodeBase64(draft.dataBase64);
    size = buf.byteLength;
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(`「${name}」超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024)}KB 上限`);
    }
    raw = extractPdfText(buf);
    if (!raw) raw = '（无法从该 PDF 提取文字，可能是扫描件或加密文件）';
  } else {
    raw = draft.text ?? (draft.dataBase64 ? decodeBase64(draft.dataBase64).toString('utf8') : '');
    size = Buffer.byteLength(raw);
    if (size > ATTACHMENT_MAX_BYTES) {
      throw new AttachmentError(`「${name}」超过 ${Math.round(ATTACHMENT_MAX_BYTES / 1024)}KB 上限`);
    }
    if (extname(name) === '.json' || mime.includes('json')) {
      try {
        raw = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        // keep raw
      }
    }
  }

  const truncated = raw.length > ATTACHMENT_MAX_TEXT;
  const text = truncated
    ? `${raw.slice(0, ATTACHMENT_MAX_TEXT)}\n\n[... 已截断 ${raw.length - ATTACHMENT_MAX_TEXT} 字]`
    : raw;
  return { name, mime: isPdf ? 'application/pdf' : mime, size, text, truncated };
}

export function extractAttachments(drafts: AttachmentDraft[] | undefined): ExtractedAttachment[] {
  if (!drafts?.length) return [];
  if (drafts.length > ATTACHMENT_MAX_FILES) {
    throw new AttachmentError(`一次最多上传 ${ATTACHMENT_MAX_FILES} 个文件`);
  }
  return drafts.map(extractOne);
}

export function formatAttachmentsPrompt(files: ExtractedAttachment[] | undefined): string {
  if (!files?.length) return '';
  return files
    .map((f) => `### ${f.name}\n${f.text}`)
    .join('\n\n');
}

export function toAttachmentPreview(file: ExtractedAttachment, max = 280): AttachmentPreview {
  const excerpt = file.text.replace(/\s+/g, ' ').trim();
  return {
    name: file.name,
    mime: file.mime,
    size: file.size,
    excerpt: excerpt.length > max ? `${excerpt.slice(0, max)}…` : excerpt,
  };
}
