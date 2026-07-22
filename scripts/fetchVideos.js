const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

async function callYoutubeApi(endpoint, params) {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API 호출 실패 (${endpoint}, ${res.status}): ${body}`);
  }
  return res.json();
}

async function getUploadsPlaylistId(channelId, apiKey) {
  const data = await callYoutubeApi('channels', {
    part: 'contentDetails',
    id: channelId,
    key: apiKey,
  });
  const item = data.items?.[0];
  if (!item) {
    throw new Error(`채널을 찾을 수 없습니다: ${channelId}`);
  }
  return item.contentDetails.relatedPlaylists.uploads;
}

async function getPlaylistVideoSnippets(playlistId, maxResults, apiKey) {
  const snippets = [];
  let pageToken;

  do {
    const data = await callYoutubeApi('playlistItems', {
      part: 'snippet',
      playlistId,
      maxResults: 50,
      pageToken,
      key: apiKey,
    });
    for (const item of data.items ?? []) {
      snippets.push(item.snippet);
    }
    pageToken = data.nextPageToken;
  } while (pageToken && snippets.length < maxResults);

  return snippets.slice(0, maxResults);
}

function matchesFilter(snippet, source) {
  const fields = source.matchFields ?? ['title'];
  const haystack = fields.map((field) => snippet[field] ?? '').join('\n');

  const includeList = source.include?.any ?? [];
  const excludeList = source.exclude?.any ?? [];

  const included = includeList.length === 0 || includeList.some((keyword) => haystack.includes(keyword));
  const excluded = excludeList.some((keyword) => haystack.includes(keyword));

  return included && !excluded;
}

function pickThumbnail(thumbnails) {
  return thumbnails?.medium?.url ?? thumbnails?.default?.url ?? thumbnails?.high?.url ?? '';
}

function parseIsoDurationToSeconds(iso) {
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, hours, minutes, seconds] = match;
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
}

// YouTube Shorts의 공식 최대 길이(3분) 기준. Data API에는 "이건 쇼츠다"를 나타내는
// 필드가 따로 없어, 영상 길이로 판별하는 것이 실질적으로 가장 신뢰도 높은 방법이다.
const SHORTS_MAX_DURATION_SECONDS = 180;

// videoId 목록의 재생시간을 조회해, Shorts로 추정되는 videoId의 Set을 반환한다.
// videos.list는 한 번에 최대 50개 id를 받으므로 청크로 나눠 호출한다.
async function findShortsVideoIds(videoIds, apiKey) {
  const shortsIds = new Set();

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    if (chunk.length === 0) continue;

    const data = await callYoutubeApi('videos', {
      part: 'contentDetails',
      id: chunk.join(','),
      key: apiKey,
    });

    for (const item of data.items ?? []) {
      const seconds = parseIsoDurationToSeconds(item.contentDetails.duration);
      if (seconds > 0 && seconds <= SHORTS_MAX_DURATION_SECONDS) {
        shortsIds.add(item.id);
      }
    }
  }

  return shortsIds;
}

// config/filters.json의 sources(채널별 규칙)를 각각 조회해 필터 조건에 맞는 영상만 반환한다.
// 채널마다 매칭 필드/포함·제외 키워드/조회 개수를 독립적으로 가질 수 있다.
// 채널·키워드와 무관하게, Shorts(3분 이하)는 항상 결과에서 제외한다.
export async function fetchMatchedVideos(config, apiKey) {
  const matched = [];

  for (const source of config.sources) {
    const uploadsPlaylistId = await getUploadsPlaylistId(source.channelId, apiKey);
    const maxResults = source.maxResultsPerChannel ?? config.defaultMaxResultsPerChannel ?? 50;
    const snippets = await getPlaylistVideoSnippets(uploadsPlaylistId, maxResults, apiKey);

    for (const snippet of snippets) {
      if (!matchesFilter(snippet, source)) continue;

      matched.push({
        videoId: snippet.resourceId.videoId,
        title: snippet.title,
        description: snippet.description,
        publishedAt: snippet.publishedAt,
        channelId: source.channelId,
        channelName: source.channelName,
        thumbnail: pickThumbnail(snippet.thumbnails),
      });
    }
  }

  const shortsIds = await findShortsVideoIds(
    matched.map((video) => video.videoId),
    apiKey,
  );
  const longFormOnly = matched.filter((video) => !shortsIds.has(video.videoId));

  longFormOnly.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return longFormOnly;
}
