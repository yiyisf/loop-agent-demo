import { describe, expect, it } from 'vitest';
import { artifactKindLabel, artifactPreviewKind, parseCsvPreview } from './artifact-kind';

describe('artifactPreviewKind', () => {
  it('classifies by extension and mime', () => {
    expect(artifactPreviewKind('README.md', 'text/plain')).toBe('markdown');
    expect(artifactPreviewKind('data.json', 'application/json')).toBe('json');
    expect(artifactPreviewKind('sheet.csv', 'text/csv')).toBe('csv');
    expect(artifactPreviewKind('notes.txt', 'text/plain')).toBe('text');
    expect(artifactPreviewKind('page.html', 'text/html')).toBe('text');
    expect(artifactPreviewKind('brief.pdf', 'application/pdf')).toBe('pdf');
    expect(artifactPreviewKind('shot.png', 'image/png')).toBe('image');
    expect(artifactPreviewKind('blob.bin', 'application/octet-stream')).toBe('binary');
  });

  it('labels kinds in Chinese or format name', () => {
    expect(artifactKindLabel.markdown).toBe('Markdown');
    expect(artifactKindLabel.binary).toBe('二进制');
  });

  it('parses a small csv', () => {
    expect(parseCsvPreview('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
