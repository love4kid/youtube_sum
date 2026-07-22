import { GoogleGenAI } from '@google/genai';

function buildPrompt(title, transcript) {
  return `다음은 유튜브 영상 "${title}"의 자막 전문이다. 시스템 지침에 따라 요약하라.

---
${transcript}
---`;
}

// 자막 텍스트를 Gemini로 요약해 "주요내용" 문자열을 반환한다.
// - model: .env(GEMINI_MODEL)에서 주입 — 특정 모델이 향후 막히거나 대체돼도 코드 수정 없이 교체 가능.
// - guidelines: SUMSUM.md 전문을 systemInstruction으로 그대로 전달 — 요약 규칙을
//   코드에 하드코딩하지 않고, 그 파일을 고치는 것만으로 요약 방식을 바꿀 수 있게 함.
export async function summarizeTranscript({ title, transcript }, apiKey, model, guidelines) {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model,
    contents: buildPrompt(title, transcript),
    config: {
      systemInstruction: guidelines,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini 응답에 텍스트가 없습니다.');
  }
  return text;
}
