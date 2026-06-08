import Anthropic from '@anthropic-ai/sdk';

import { config } from '../config.js';
import { transcribeAudio } from '../multimodal/transcribe.js';
import type { AgentResponse, NormalizedInput } from '../types.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { clientTools, clientToolSpecs } from './tools/index.js';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

/** 지원하는 이미지 media type 으로 정규화. */
function imageMediaType(mime: string): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' {
  switch (mime) {
    case 'image/png':
      return 'image/png';
    case 'image/webp':
      return 'image/webp';
    case 'image/gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

/** 정규화 입력 → 첫 user 메시지 content 블록. */
function buildUserContent(
  input: NormalizedInput,
  transcript: string | null,
): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];

  for (const img of input.images) {
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMediaType(img.mimeType),
        data: img.base64,
      },
    });
  }

  // 텍스트 구성: 사용자가 친 텍스트 + (서버 전사가 있으면) 음성 전사.
  const parts: string[] = [];
  if (input.text) parts.push(input.text);
  if (transcript) parts.push(`(첨부 음성 전사) ${transcript}`);
  if (parts.length === 0 && input.images.length > 0) {
    parts.push('이 이미지를 보고 무엇인지/무슨 의도인지 파악해서 도와줘.');
  }
  if (parts.length === 0) parts.push('안녕하세요.');

  blocks.push({ type: 'text', text: parts.join('\n\n') });
  return blocks;
}

interface Citation {
  title?: string;
  url: string;
}

/** 응답 content 블록들에서 최종 텍스트와 웹검색 인용을 수집. */
function harvest(content: Anthropic.ContentBlock[]): { text: string; citations: Citation[] } {
  let text = '';
  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const block of content) {
    if (block.type === 'text') {
      text += block.text;
      const cits = block.citations as Array<Record<string, unknown>> | null | undefined;
      if (Array.isArray(cits)) {
        for (const c of cits) {
          const url = typeof c.url === 'string' ? c.url : undefined;
          if (url && !seen.has(url)) {
            seen.add(url);
            citations.push({ url, title: typeof c.title === 'string' ? c.title : undefined });
          }
        }
      }
    }
  }
  return { text: text.trim(), citations };
}

export async function runAgent(input: NormalizedInput): Promise<Omit<AgentResponse, 'ok' | 'requestId' | 'elapsedMs'>> {
  // 1) 음성 첨부가 있으면(선택적) 전사.
  const transcript = input.audio ? await transcribeAudio(input.audio) : null;

  // 2) 도구 구성: 커스텀(get_weather) + 네이티브 웹검색(옵션).
  const tools: Anthropic.ToolUnion[] = [...clientToolSpecs];
  if (config.enableWebSearch) {
    tools.push({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    } as Anthropic.ToolUnion);
  }

  const nowISO = new Date().toISOString();
  const system = buildSystemPrompt(input.meta, nowISO);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserContent(input, transcript) },
  ];

  const toolsUsed = new Set<string>();
  let finalText = '';
  let citations: Citation[] = [];

  for (let turn = 0; turn < config.maxAgentTurns; turn++) {
    const res = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system,
      tools,
      messages,
    });

    // 네이티브 서버도구(웹검색) 사용 흔적 기록.
    for (const block of res.content) {
      if (block.type === 'server_tool_use') toolsUsed.add(block.name);
    }

    const harvested = harvest(res.content);
    if (harvested.text) finalText = harvested.text;
    if (harvested.citations.length) citations = harvested.citations;

    // 어시스턴트 턴을 대화에 추가.
    messages.push({ role: 'assistant', content: res.content });

    // 서버 도구가 오래 걸려 일시중단되면 그대로 이어서 진행.
    if (res.stop_reason === 'pause_turn') continue;

    // 커스텀 클라이언트 도구 호출 처리.
    if (res.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ContentBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        toolsUsed.add(block.name);
        const tool = clientTools[block.name];
        let result: unknown;
        try {
          result = tool
            ? await tool.run(block.input as Record<string, unknown>)
            : { error: `알 수 없는 도구: ${block.name}` };
        } catch (err) {
          result = { error: `도구 실행 오류: ${(err as Error).message}` };
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn / max_tokens 등 → 종료.
    break;
  }

  if (!finalText) {
    finalText = '죄송해요, 답변을 생성하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }

  return {
    message: finalText,
    toolsUsed: [...toolsUsed],
    citations,
    ...(transcript ? { transcript } : {}),
  };
}
