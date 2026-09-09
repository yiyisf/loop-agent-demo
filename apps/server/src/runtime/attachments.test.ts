import { describe, expect, it } from 'vitest';
import {
  AttachmentError,
  extractAttachments,
  extractOne,
  extractPdfText,
  formatAttachmentsPrompt,
  toAttachmentPreview,
} from './attachments.js';

function simplePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.1\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj\n4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
  );
}

describe('attachments', () => {
  it('extracts markdown text and builds a preview', () => {
    const file = extractOne({
      name: 'notes.md',
      mime: 'text/markdown',
      text: '# 季度目标\n提高续费率到 40%。',
    });
    expect(file.name).toBe('notes.md');
    expect(file.text).toContain('续费率');
    expect(toAttachmentPreview(file).excerpt).toContain('季度目标');
  });

  it('pretty-prints JSON', () => {
    const file = extractOne({
      name: 'data.json',
      mime: 'application/json',
      text: '{"a":1}',
    });
    expect(file.text).toBe('{\n  "a": 1\n}');
  });

  it('extracts text from a simple uncompressed PDF', () => {
    const raw = extractPdfText(simplePdf('Hello PDF'));
    expect(raw).toContain('Hello PDF');
    const file = extractOne({
      name: 'brief.pdf',
      mime: 'application/pdf',
      dataBase64: simplePdf('Quarterly retention 40%').toString('base64'),
    });
    expect(file.text).toContain('Quarterly retention 40%');
  });

  it('rejects unsupported types and too many files', () => {
    expect(() => extractOne({ name: 'pic.png', mime: 'image/png', dataBase64: 'aaaa' })).toThrow(
      AttachmentError,
    );
    expect(() =>
      extractAttachments(
        Array.from({ length: 9 }, (_, i) => ({
          name: `f${i}.txt`,
          mime: 'text/plain',
          text: 'x',
        })),
      ),
    ).toThrow(/最多/);
  });

  it('formats files for the model prompt', () => {
    const prompt = formatAttachmentsPrompt([
      {
        name: 'a.md',
        mime: 'text/markdown',
        size: 3,
        text: 'hi',
        truncated: false,
      },
    ]);
    expect(prompt).toBe('### a.md\nhi');
  });
});
