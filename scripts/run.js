import 'dotenv/config';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fetchMatchedVideos } from './fetchVideos.js';
import { getTranscriptText } from './fetchTranscript.js';
import { summarizeTranscript } from './summarize.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config', 'filters.json');
const DATA_PATH = path.join(ROOT, 'data', 'videos.json');
const SUMMARY_GUIDELINES_PATH = path.join(ROOT, 'SUMSUM.md');

// Gemini 무료 티어의 분당 요청 한도를 넘지 않도록 요약 호출 사이에 두는 최소 간격.
const GEMINI_CALL_DELAY_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadJson(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function main() {
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  if (!youtubeApiKey) throw new Error('YOUTUBE_API_KEY가 설정되지 않았습니다 (.env 확인).');
  if (!geminiApiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인).');

  const config = await loadJson(CONFIG_PATH, null);
  if (!config) throw new Error('config/filters.json을 찾을 수 없습니다.');

  let summaryGuidelines;
  try {
    summaryGuidelines = await readFile(SUMMARY_GUIDELINES_PATH, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('SUMSUM.md를 찾을 수 없습니다 (요약 지침 파일).');
    throw err;
  }

  const existingData = await loadJson(DATA_PATH, { updatedAt: null, videos: [] });
  const existingById = new Map(existingData.videos.map((video) => [video.videoId, video]));

  console.log('[1/3] YouTube에서 영상 목록 조회 중...');
  const matched = await fetchMatchedVideos(config, youtubeApiKey);
  console.log(`  -> 조건에 맞는 영상 ${matched.length}건 발견`);

  let newCount = 0;
  let summarizedCount = 0;
  let pendingCount = 0;
  const resultVideos = [];

  for (const video of matched) {
    const existing = existingById.get(video.videoId);

    // 이미 요약이 완료된 영상은 재처리하지 않는다 (캐시, Gemini 재호출 방지).
    // video에는 transcriptStatus/summary 필드가 없으므로 existing의 값이 그대로 유지된다.
    if (existing?.transcriptStatus === 'ok') {
      resultVideos.push({ ...existing, ...video });
      continue;
    }

    if (!existing) newCount += 1;

    console.log(`[2/3] 자막 확인: ${video.title}`);
    const transcript = await getTranscriptText(video.videoId);

    if (!transcript) {
      pendingCount += 1;
      resultVideos.push({
        ...video,
        transcriptStatus: 'pending',
        summary: null,
        summaryUpdatedAt: null,
        firstFailedAt: existing?.firstFailedAt ?? new Date().toISOString(),
      });
      continue;
    }

    console.log(`[3/3] Gemini 요약 생성: ${video.title}`);
    try {
      const summary = await summarizeTranscript(
        { title: video.title, transcript },
        geminiApiKey,
        geminiModel,
        summaryGuidelines,
      );
      summarizedCount += 1;
      resultVideos.push({
        ...video,
        transcriptStatus: 'ok',
        summary,
        summaryUpdatedAt: new Date().toISOString(),
        firstFailedAt: null,
      });
    } catch (err) {
      console.error(`  요약 실패: ${err.message}`);
      pendingCount += 1;
      resultVideos.push({
        ...video,
        transcriptStatus: 'pending',
        summary: null,
        summaryUpdatedAt: null,
        firstFailedAt: existing?.firstFailedAt ?? new Date().toISOString(),
      });
    } finally {
      await sleep(GEMINI_CALL_DELAY_MS);
    }
  }

  const output = {
    updatedAt: new Date().toISOString(),
    videos: resultVideos,
  };

  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  const tmpPath = `${DATA_PATH}.tmp`;
  await writeFile(tmpPath, JSON.stringify(output, null, 2), 'utf-8');
  await rename(tmpPath, DATA_PATH);

  console.log(
    `완료: 신규 ${newCount}건 / 요약 성공 ${summarizedCount}건 / 준비중(자막없음) ${pendingCount}건`,
  );
}

main().catch((err) => {
  console.error('실행 실패:', err);
  process.exitCode = 1;
});
