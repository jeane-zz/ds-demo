import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('/api/design-docs', () => {
  it('returns generated design docs with markdown content by id', async () => {
    const response = await GET(
      new NextRequest('http://localhost:3000/api/design-docs?id=01')
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      title: string;
      content: string;
    };

    expect(body.id).toBe('01');
    expect(body.title).toBe('LLM Provider 架构');
    expect(body.content).toContain('#');
  });
});
