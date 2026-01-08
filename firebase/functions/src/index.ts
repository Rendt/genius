import 'dotenv/config';
import * as functions from 'firebase-functions';
import { GoogleGenAI, Type } from '@google/genai';

const REGION = 'us-central1';

const getApiKey = (): string => {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv) {
    functions.logger.info('Found GEMINI_API_KEY in environment variables.');
    return fromEnv;
  }

  const config = functions.config();
  const fromConfig = config?.gemini?.key as string | undefined;
  if (fromConfig) {
    functions.logger.info('Found gemini.key in Firebase runtime config.');
    return fromConfig;
  }

  throw new Error(
    'GEMINI_API_KEY is missing. For local development, create a file at `firebase/functions/.env` and add the line `GEMINI_API_KEY="YOUR_KEY"`. For deployed functions, run `firebase functions:config:set gemini.key="YOUR_KEY"`.'
  );
};

let cachedKey: string | null = null;
let cachedClient: GoogleGenAI | null = null;

const getClient = () => {
  const key = getApiKey();
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new GoogleGenAI({ apiKey: key });
    cachedKey = key;
    functions.logger.info('Initialized GoogleGenAI client with new API key hash.');
  }
  return cachedClient;
};

type Handler<TPayload, TResult> = (payload: TPayload) => Promise<TResult>;

type HttpRequest = functions.https.Request;
type HttpResponse = functions.Response<any>;

const withHttp = <TPayload, TResult>(handler: Handler<TPayload, TResult>) =>
  functions
    .region(REGION)
    .https.onRequest(async (req: HttpRequest, res: HttpResponse) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }

      if (req.method !== 'POST') {
        res.status(405).json({ error: { message: 'Method not allowed. Use POST.' } });
        return;
      }

      try {
        const payload = (req.body || {}) as TPayload;
        const result = await handler(payload);
        res.status(200).json({ result });
      } catch (error: any) {
        const message = error?.message || 'Unexpected error';
        const stack = error?.stack || 'No stack trace available';
        functions.logger.error('Caught an exception:', {
            message: message,
            stack: stack,
            error: error
        });
        res.status(500).json({
            error: {
                message: message,
                stack: stack
            }
        });
      }
    });

type ScopingGoal = {
  id: string;
  text: string;
  isSelected: boolean;
  priority: 'Useful' | 'Critical' | 'Interesting';
};

interface ScopingPayload {
  topic: string;
  prefs: {
    learningStyle: string;
    motivationTrigger: string;
    attentionSpan: string;
    complexityPreference: string;
  };
  sessionIndex: number;
  totalSessions: number;
  programTopic: string;
}

interface SprintPayload {
  topic: string;
  priming: {
    relevance: string;
    relation: string;
    scope: string;
  };
  scopingData: {
    complexity: string;
    thresholdConcepts: string[];
    goals: ScopingGoal[];
  };
  prefs: ScopingPayload['prefs'];
}

export const resolveWebPageTitle = withHttp(async ({ url }: { url?: string }) => {
  if (!url) {
    throw new Error('`url` is required.');
  }

  const client = getClient();
  const modelName = 'gemini-3-flash-preview';

  const prompt = `
    I have this URL: "${url}".
    I need the actual human-readable Title of the page or video.
    Use Google Search to find it.

    Rules:
    1. Return ONLY the title string.
    2. Do NOT return the URL.
    3. Do NOT add quotes.
    4. If it's a YouTube video, return the video title.
    5. If you absolutely cannot find it, return "External Resource".
  `;

  try {
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: 'text/plain'
      }
    });

    let title = response.text?.trim() || 'External Resource';
    title = title.replace(/^"|"$/g, '');

    if (title.includes('http')) {
      title = 'External Resource';
    }

    return title;
  } catch (error: any) {
    functions.logger.error('Title resolution failed', { error, url });
    throw new Error(error?.message || 'Title resolution failed.');
  }
});

export const generateSyllabus = withHttp(
  async ({ topic, complexity }: { topic?: string; complexity?: string }) => {
    if (!topic) {
      throw new Error('`topic` is required.');
    }

    const client = getClient();
    const modelName = 'gemini-3-flash-preview';

    const prompt = `
      Act as an Accelerated Learning Architect.
      Design a 7-Session Mastery Program for the topic: "${topic}".
      Complexity Level: ${complexity || 'Intermediate'}.

      CRITICAL: If the input topic is a URL (like YouTube, Medium, etc.), use the Google Search tool to find the ACTUAL title and context of that content.

      Extract a concise, meaningful, and punchy "Program Title" (2-6 words) based on the actual content found. Do not use the URL as the title.

      The program must be a logical progression:
      Session 1: Foundations & Core Principles
      Session 2-3: Mechanisms & Deep Dives
      Session 4-5: Applications & Synthesis
      Session 6: Advanced/Edge Cases
      Session 7: Mastery & Integration

      Return ONLY a JSON object.
      Schema: { title: string, syllabus: string[] }
    `;

    try {
      const response = await client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              syllabus: { type: Type.ARRAY, items: { type: Type.STRING } }
            }
          }
        }
      });

      const data = JSON.parse(response.text ?? '{}');
      return {
        title: data.title || topic,
        syllabus: Array.isArray(data.syllabus) ? data.syllabus.slice(0, 7) : []
      };
    } catch (error: any) {
      functions.logger.error('Syllabus generation failed', { error, topic });
      throw new Error(error?.message || 'Syllabus generation failed.');
    }
  }
);

export const performInitialScoping = withHttp(async (payload: ScopingPayload) => {
  const { topic, prefs, sessionIndex, totalSessions, programTopic } = payload;
  if (!topic) {
    throw new Error('`topic` is required.');
  }

  const client = getClient();
  const modelName = 'gemini-3-flash-preview';

  const contextStr = `
    User Profile: ${prefs.learningStyle}, ${prefs.complexityPreference}.
    Program Context: This is Session ${sessionIndex + 1} of ${totalSessions} in a program about "${programTopic}".
    Current Session Focus: "${topic}".
  `;

  const prompt = `
    Act as an Accelerated Learning Curriculum Designer.
    Analyze the specific session topic "${topic}" within the broader context of "${programTopic}".

    ${contextStr}

    Return a JSON object with:
    1. "complexity": The assessed complexity level. MUST be one of: "Beginner", "Intermediate", "Expert".
    2. "thresholdConcepts": 8-10 key terms/jargon specific to THIS session.
    3. "goals": A list of 5 specific learning outcomes for THIS session.

    Schema: { complexity: string, thresholdConcepts: string[], goals: string[] }
  `;

  try {
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            complexity: { type: Type.STRING, enum: ['Beginner', 'Intermediate', 'Expert'] },
            thresholdConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
            goals: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    const data = JSON.parse(response.text ?? '{}');

    const scopedGoals: ScopingGoal[] = Array.isArray(data.goals)
      ? data.goals.map((text: string) => ({
          id: crypto.randomUUID(),
          text,
          isSelected: true,
          priority: 'Useful'
        }))
      : [];

    return {
      complexity: data.complexity || 'Intermediate',
      thresholdConcepts: Array.isArray(data.thresholdConcepts) ? data.thresholdConcepts : [],
      goals: scopedGoals
    };
  } catch (error: any) {
    functions.logger.error('Initial scoping failed', { error, topic });
    throw new Error(error?.message || 'Initial scoping failed.');
  }
});

export const generateSprintContent = withHttp(async (payload: SprintPayload) => {
  const { topic, priming, scopingData, prefs } = payload;
  if (!topic) {
    throw new Error('`topic` is required.');
  }

  const client = getClient();
  const modelName = 'gemini-3-flash-preview';

  const selectedGoals = (scopingData.goals || []).filter(goal => goal.isSelected);
  const goalContext = selectedGoals.map(goal => `- [${goal.priority}] ${goal.text}`).join('\n');

  const prompt = `
    Create a "High-Velocity Learning Unit" for "${topic}".

    User Priming Context:
    - Relevance: ${priming.relevance}
    - Context: ${priming.relation}
    - Expectations: ${priming.scope}

    Agreed Learning Goals (Prioritized):
    ${goalContext}

    User Profile: ${prefs.complexityPreference}, ${prefs.learningStyle}.

    Protocol:
    1. Title: Create a clean, engaging headline for this unit (do NOT use a URL).
    2. Motivating Statement: Directly address the user's "Relevance" answer.
    3. Sections: Create 4 learning sections. Content must be tailored to the prioritized goals.
       - For "Critical" goals, go deep.
       - For "Interesting" goals, add trivia or lateral connections.
    4. **CRITICAL**: Ensure the "thresholdConcepts" (${scopingData.thresholdConcepts.join(', ')}) appear naturally in the text.
    5. Quiz: 2 questions based on the content.
    6. Word Pairs: 8 pairs for memory game (Concept + Short Definition).

    Output JSON matching LearningUnit schema. Fixed duration: 10 minutes.
  `;

  try {
    const response = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            duration: { type: Type.NUMBER },
            complexity: { type: Type.STRING },
            motivatingStatement: { type: Type.STRING },
            smartGoals: { type: Type.ARRAY, items: { type: Type.STRING } },
            thresholdConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING },
                  imageKeyword: { type: Type.STRING },
                  interactionType: { type: Type.STRING, enum: ['READ', 'REFLECTION'] }
                }
              }
            },
            wordPairs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  a: { type: Type.STRING },
                  b: { type: Type.STRING }
                }
              }
            },
            quiz: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  question: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctIndex: { type: Number },
                  explanation: { type: Type.STRING }
                }
              }
            }
          }
        }
      }
    });

    const data = JSON.parse(response.text ?? '{}');
    return {
      ...data,
      id: data.id || crypto.randomUUID(),
      duration: data.duration || 10
    };
  } catch (error: any) {
    functions.logger.error('Sprint generation failed', { error, topic });
    throw new Error(error?.message || 'Sprint generation failed.');
  }
});
