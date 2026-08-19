import { describe, expect, test } from 'bun:test';
import { parseSseEvents } from './sse-client.js';

describe('remote HTTP SSE client', () => {
  test('parses event names and JSON data across frames', () => {
    const events = parseSseEvents(
      'event: progress\ndata: {"message":"正在搜索"}\n\n' +
      'event: completed\ndata: {"answer":"完成"}\n\n',
    );
    expect(events).toEqual([
      { type: 'progress', message: '正在搜索' },
      { type: 'completed', answer: '完成' },
    ]);
  });

  test('ignores comments and incomplete frames', () => {
    expect(parseSseEvents(': keepalive\n\nevent: progress\ndata: {"message":"partial"}')).toEqual([]);
  });
});
