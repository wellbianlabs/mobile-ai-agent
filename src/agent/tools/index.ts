import type Anthropic from '@anthropic-ai/sdk';

import { runWeather, weatherToolSpec } from './weather.js';

/**
 * 클라이언트(이 백엔드)가 직접 실행하는 커스텀 도구 레지스트리.
 * Claude 네이티브 web_search 는 Anthropic 서버가 직접 실행하므로 여기 없다.
 */

export interface ClientTool {
  spec: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<unknown>;
}

export const clientTools: Record<string, ClientTool> = {
  get_weather: {
    spec: weatherToolSpec,
    run: (input) => runWeather(input as { location?: string; days?: number }),
  },
};

export const clientToolSpecs: Anthropic.Tool[] = Object.values(clientTools).map((t) => t.spec);
