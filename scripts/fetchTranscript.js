import { fetchTranscript as fetchYoutubeTranscript } from 'youtube-transcript';

function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mmStr = String(mm).padStart(2, '0');
  const ssStr = String(ss).padStart(2, '0');
  return hh > 0 ? `${hh}:${mmStr}:${ssStr}` : `${mm}:${ssStr}`;
}

// youtube-transcript는 자막이 srv3(밀리초) 포맷인지 classic(초) 포맷인지에 따라
// offset/duration 단위가 다르게 온다. 한 문서 안에서는 단위가 섞이지 않으므로,
// 발화 한 줄의 길이(duration)가 보통 1~10초라는 점을 이용해 앞부분 샘플로 단위를 추정한다.
function detectIsMilliseconds(segments) {
  const sample = segments.slice(0, Math.min(20, segments.length));
  const avgDuration = sample.reduce((sum, seg) => sum + seg.duration, 0) / sample.length;
  return avgDuration > 15;
}

// 자막 세그먼트를 "[MM:SS] 텍스트" 형식의 줄로 합쳐, 요약 시 타임스탬프를
// 인용할 수 있게 한다 (SUMSUM.md 1번 항목: 가능한 경우 시간대 표기).
function segmentsToTimestampedText(segments) {
  if (segments.length === 0) return null;

  const isMilliseconds = detectIsMilliseconds(segments);
  const toSeconds = (value) => (isMilliseconds ? value / 1000 : value);

  const lines = segments
    .map((segment) => {
      const text = segment.text.replace(/\s+/g, ' ').trim();
      if (!text) return null;
      return `[${formatTimestamp(toSeconds(segment.offset))}] ${text}`;
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

// 한국어 자막을 우선 시도하고, 없으면 언어 지정 없이(기본 트랙) 한 번 더 시도한다.
// 둘 다 실패하면 null을 반환하고, 호출부는 이를 "자막 없음(준비 중)"으로 처리한다.
export async function getTranscriptText(videoId) {
  try {
    const segments = await fetchYoutubeTranscript(videoId, { lang: 'ko' });
    return segmentsToTimestampedText(segments);
  } catch (koError) {
    try {
      const segments = await fetchYoutubeTranscript(videoId);
      return segmentsToTimestampedText(segments);
    } catch (fallbackError) {
      return null;
    }
  }
}
