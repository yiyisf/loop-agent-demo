export type ArtifactPreviewKind = 'markdown' | 'json' | 'csv' | 'text' | 'pdf' | 'image' | 'binary';

export function artifactPreviewKind(name: string, mime: string): ArtifactPreviewKind {
  const ext = extname(name);
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (m.includes('json') || ext === '.json') return 'json';
  if (m.includes('csv') || ext === '.csv') return 'csv';
  if (m.includes('markdown') || ext === '.md' || ext === '.markdown') return 'markdown';
  if (
    m.startsWith('text/') ||
    ext === '.txt' ||
    ext === '.xml' ||
    ext === '.html' ||
    ext === '.htm' ||
    ext === '.js' ||
    ext === '.ts' ||
    ext === '.py' ||
    ext === '.css'
  ) {
    return 'text';
  }
  return 'binary';
}

export const artifactKindLabel: Record<ArtifactPreviewKind, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
  text: '文本',
  pdf: 'PDF',
  image: '图片',
  binary: '二进制',
};

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function parseCsvPreview(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(0, 40)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}
