"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSprintContent = exports.performInitialScoping = exports.generateSyllabus = exports.resolveWebPageTitle = void 0;
require("dotenv/config");
const functions = __importStar(require("firebase-functions"));
const genai_1 = require("@google/genai");
const REGION = 'us-central1';
const getApiKey = () => {
    const fromEnv = process.env.GEMINI_API_KEY;
    if (fromEnv) {
        functions.logger.info('Found GEMINI_API_KEY in environment variables.');
        return fromEnv;
    }
    const config = functions.config();
    const fromConfig = config?.gemini?.key;
    if (fromConfig) {
        functions.logger.info('Found gemini.key in Firebase runtime config.');
        return fromConfig;
    }
    throw new Error('GEMINI_API_KEY is missing. For local development, create a file at `firebase/functions/.env` and add the line `GEMINI_API_KEY="YOUR_KEY"`. For deployed functions, run `firebase functions:config:set gemini.key="YOUR_KEY"`.');
};
let cachedKey = null;
let cachedClient = null;
const getClient = () => {
    const key = getApiKey();
    if (!cachedClient || cachedKey !== key) {
        cachedClient = new genai_1.GoogleGenAI({ apiKey: key });
        cachedKey = key;
        functions.logger.info('Initialized GoogleGenAI client with new API key hash.');
    }
    return cachedClient;
};
const withHttp = (handler) => functions
    .region(REGION)
    .https.onRequest(async (req, res) => {
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
        const payload = (req.body || {});
        const result = await handler(payload);
        res.status(200).json({ result });
    }
    catch (error) {
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
exports.resolveWebPageTitle = withHttp(async ({ url }) => {
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
    }
    catch (error) {
        functions.logger.error('Title resolution failed', { error, url });
        throw new Error(error?.message || 'Title resolution failed.');
    }
});
exports.generateSyllabus = withHttp(async ({ topic, complexity }) => {
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
                    type: genai_1.Type.OBJECT,
                    properties: {
                        title: { type: genai_1.Type.STRING },
                        syllabus: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } }
                    }
                }
            }
        });
        const data = JSON.parse(response.text ?? '{}');
        return {
            title: data.title || topic,
            syllabus: Array.isArray(data.syllabus) ? data.syllabus.slice(0, 7) : []
        };
    }
    catch (error) {
        functions.logger.error('Syllabus generation failed', { error, topic });
        throw new Error(error?.message || 'Syllabus generation failed.');
    }
});
exports.performInitialScoping = withHttp(async (payload) => {
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
                    type: genai_1.Type.OBJECT,
                    properties: {
                        complexity: { type: genai_1.Type.STRING, enum: ['Beginner', 'Intermediate', 'Expert'] },
                        thresholdConcepts: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } },
                        goals: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } }
                    }
                }
            }
        });
        const data = JSON.parse(response.text ?? '{}');
        const scopedGoals = Array.isArray(data.goals)
            ? data.goals.map((text) => ({
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
    }
    catch (error) {
        functions.logger.error('Initial scoping failed', { error, topic });
        throw new Error(error?.message || 'Initial scoping failed.');
    }
});
exports.generateSprintContent = withHttp(async (payload) => {
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
                    type: genai_1.Type.OBJECT,
                    properties: {
                        id: { type: genai_1.Type.STRING },
                        title: { type: genai_1.Type.STRING },
                        duration: { type: genai_1.Type.NUMBER },
                        complexity: { type: genai_1.Type.STRING },
                        motivatingStatement: { type: genai_1.Type.STRING },
                        smartGoals: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } },
                        thresholdConcepts: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } },
                        sections: {
                            type: genai_1.Type.ARRAY,
                            items: {
                                type: genai_1.Type.OBJECT,
                                properties: {
                                    title: { type: genai_1.Type.STRING },
                                    content: { type: genai_1.Type.STRING },
                                    imageKeyword: { type: genai_1.Type.STRING },
                                    interactionType: { type: genai_1.Type.STRING, enum: ['READ', 'REFLECTION'] }
                                }
                            }
                        },
                        wordPairs: {
                            type: genai_1.Type.ARRAY,
                            items: {
                                type: genai_1.Type.OBJECT,
                                properties: {
                                    a: { type: genai_1.Type.STRING },
                                    b: { type: genai_1.Type.STRING }
                                }
                            }
                        },
                        quiz: {
                            type: genai_1.Type.ARRAY,
                            items: {
                                type: genai_1.Type.OBJECT,
                                properties: {
                                    id: { type: genai_1.Type.STRING },
                                    question: { type: genai_1.Type.STRING },
                                    options: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } },
                                    correctIndex: { type: Number },
                                    explanation: { type: genai_1.Type.STRING }
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
    }
    catch (error) {
        functions.logger.error('Sprint generation failed', { error, topic });
        throw new Error(error?.message || 'Sprint generation failed.');
    }
});
