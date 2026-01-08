import { LearningUnit, ScopingData, ScopedGoal, SprintLog, UserPreferences } from '../types';

type LogCallback = (type: 'info' | 'request' | 'response' | 'error' | 'state', message: string, data?: any) => void;

const getBase = (): string => {
  try {
    // @ts-ignore
    const env = (import.meta as any)?.env;
    const v = env?.VITE_FUNCTIONS_BASE_URL || env?.VITE_FUNCTIONS_ORIGIN;
    if (v) return (v as string).replace(/\/$/, '');
  } catch (e) { /* ignore */ }
  return '/api';
};

const BASE = getBase();

// Determine whether to use in-browser mock function handlers.
const _env = (import.meta as any)?.env || {};
const USE_MOCK_FUNCTIONS = _env?.VITE_USE_MOCK_FUNCTIONS === 'true' || (
  !_env?.VITE_FUNCTIONS_BASE_URL && !_env?.VITE_FUNCTIONS_ORIGIN && !_env?.VITE_FUNCTIONS_EMULATOR && !_env?.VITE_FUNCTIONS_PROJECT
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mockHandlers: Record<string, (payload: any) => Promise<any>> = {
  resolveWebPageTitle: async ({ url }: { url?: string }) => {
    await sleep(120);
    if (!url) return 'External Resource';
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '') + ' — Example Title';
    } catch {
      return 'External Resource';
    }
  },
  generateSyllabus: async ({ topic, complexity }: { topic?: string; complexity?: string }) => {
    await sleep(300);
    const t = topic || 'Topic';
    return {
      title: `${t} Mastery`,
      syllabus: [
        'Foundations & Core Principles',
        'Mechanisms & Deep Dive I',
        'Mechanisms & Deep Dive II',
        'Applications & Synthesis I',
        'Applications & Synthesis II',
        'Advanced Topics & Edge Cases',
        'Mastery & Integration'
      ]
    };
  },
  performInitialScoping: async (payload: any) => {
    await sleep(220);
    const topic = payload?.topic || 'Topic';
    return {
      complexity: 'Intermediate',
      thresholdConcepts: ['Concept A', 'Concept B', 'Concept C', 'Concept D', 'Concept E', 'Concept F', 'Concept G', 'Concept H'],
      goals: Array.from({ length: 5 }).map((_, i) => ({ id: `g${i + 1}`, text: `Goal ${i + 1} for ${topic}`, isSelected: true, priority: 'Useful' }))
    };
  },
  generateSprintContent: async (payload: any) => {
    await sleep(300);
    const topic = payload?.topic || 'Topic';
    return {
      id: `mock-${Date.now()}`,
      title: `${topic}: Quick Unit`,
      duration: 10,
      complexity: 'Intermediate',
      motivatingStatement: `This short unit makes ${topic} relevant and actionable.`,
      smartGoals: ['Understand core concept', 'Apply in a simple example'],
      thresholdConcepts: payload?.scopingData?.thresholdConcepts || ['Concept A', 'Concept B'],
      sections: [
        { title: 'Overview', content: 'Quick overview content.', imageKeyword: topic, interactionType: 'READ' },
        { title: 'Practice', content: 'Short practice activity.', imageKeyword: topic, interactionType: 'REFLECTION' }
      ],
      wordPairs: Array.from({ length: 8 }).map((_, i) => ({ a: `Term${i + 1}`, b: `Def${i + 1}` })),
      quiz: [
        { id: 'q1', question: 'Sample question?', options: ['A', 'B', 'C'], correctIndex: 0, explanation: 'Because...' },
        { id: 'q2', question: 'Another?', options: ['A', 'B'], correctIndex: 1, explanation: 'Because...' }
      ]
    };
  }
};
let logger: LogCallback | null = null;
export const setLogger = (cb: LogCallback | null) => { logger = cb; };

const log = (type: Parameters<LogCallback>[0], message: string, data?: any) => {
  if (logger) {
    try { logger(type, message, data); } catch { /* ignore */ }
  } else {
    if (type === 'error') console.error('[GENIUS]', message, data);
    else console.log('[GENIUS]', message, data);
  }
};

const callFunction = async (name: string, payload: any) => {
  const base = BASE;
  if (USE_MOCK_FUNCTIONS) {
    log('info', `Mocking function ${name}`, payload);
    const fn = (mockHandlers as any)[name];
    if (fn) return fn(payload);
    throw new Error(`No mock handler for function ${name}`);
  }
  const url = `${base.replace(/\/$/, '')}/${name}`.replace(/:\/\//, '://');
  log('request', `POST ${url}`, payload);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  } catch (err) {
    // Network error, try fallback if available
    log('info', `Primary function URL failed, attempting fallback: ${err}`);
    // attempt fallback base from env: VITE_FUNCTIONS_EMULATOR or VITE_FUNCTIONS_PROJECT
    // @ts-ignore
    const env = (import.meta as any)?.env || {};
    const project = env?.VITE_FUNCTIONS_PROJECT as string | undefined;
    const emulator = env?.VITE_FUNCTIONS_EMULATOR as string | undefined;
    const fallbackBase = emulator ? emulator.replace(/\/$/, '') : (project ? `http://127.0.0.1:5001/${project}/us-central1` : undefined);
    if (!fallbackBase) throw err;
    const fallbackUrl = `${fallbackBase}/${name}`;
    log('request', `POST fallback ${fallbackUrl}`, payload);
    res = await fetch(fallbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    // if 404 try a secondary fallback if possible
    if (res.status === 404) {
      log('info', `Received 404 from ${url} for ${name}. Trying hosting-style /api/${name} fallback.`);
      try {
        const apiFallback = `/api/${name}`;
        const res2 = await fetch(apiFallback, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
        const text2 = await res2.text();
        let json2: any = null;
        try { json2 = text2 ? JSON.parse(text2) : null; } catch { json2 = { raw: text2 }; }
        if (res2.ok) {
          const result2 = json2?.result ?? json2;
          log('response', `Response from fallback /api/${name}`, result2);
          return result2;
        }
      } catch (e) {
        log('info', `Fallback /api/${name} also failed: ${e}`);
      }
    }

    const errMsg = json?.error?.message || `Function ${name} failed with ${res.status}`;
    log('error', errMsg, { status: res.status, body: json });
    throw new Error(errMsg);
  }
  const result = json?.result ?? json;
  log('response', `Response from ${name}`, result);
  return result;
};

export const geniusEngine = {
  setLogger,
  resolveWebPageTitle: async (url: string) => {
    try {
      const r = await callFunction('resolveWebPageTitle', { url });
      return typeof r === 'string' ? r : (r as any)?.result ?? '';
    } catch (e: any) {
      log('error', `Title resolution error: ${e?.message || e}`, e);
      return 'External Resource';
    }
  },
  generateSyllabus: async (topic: string, complexity: string) => {
    const r = await callFunction('generateSyllabus', { topic, complexity });
    return r as { title: string; syllabus: string[] };
  },
  performInitialScoping: async (topic: string, prefs: UserPreferences, sessionIndex: number, totalSessions: number, programTopic: string) => {
    const payload = { topic, prefs, sessionIndex, totalSessions, programTopic };
    const r = await callFunction('performInitialScoping', payload);
    return r as ScopingData;
  },
  generateSprintContent: async (topic: string, priming: SprintLog['primingAnswers'], scopingData: ScopingData, prefs: UserPreferences) => {
    const payload = { topic, priming, scopingData, prefs };
    const r = await callFunction('generateSprintContent', payload);
    return r as LearningUnit;
  }
};
