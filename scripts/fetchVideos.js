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

function matchesFilter(snippet, config) {
  const fields = config.matchFields ?? ['title', 'description'];
  const haystack = fields.map((field) => snippet[field] ?? '').join('\n');

  const includeList = config.include?.any ?? [];
  const excludeList = config.exclude?.any ?? [];

  const included = includeList.length === 0 || includeList.some((keyword) => haystack.includes(keyword));
  const excluded = excludeList.some((keyword) => haystack.includes(keyword));

  return included && !excluded;
}

function pickThumbnail(thumbnails) {
  return thumbnails?.medium?.url ?? thumbnails?.default?.url ?? thumbnails?.high?.url ?? '';
}

// config/filters.json에 등록된 모든 채널을 조회해 필터 조건에 맞는 영상만 반환한다.
export async function fetchMatchedVideos(config, apiKey) {
  const matched = [];

  for (const channel of config.channels) {
    const uploadsPlaylistId = await getUploadsPlaylistId(channel.channelId, apiKey);
    const snippets = await getPlaylistVideoSnippets(
      uploadsPlaylistId,
      config.maxResultsPerChannel ?? 50,
      apiKey,
    );

    for (const snippet of snippets) {
      if (!matchesFilter(snippet, config)) continue;

      matched.push({
        videoId: snippet.resourceId.videoId,
        title: snippet.title,
        description: snippet.description,
        publishedAt: snippet.publishedAt,
        channelId: channel.channelId,
        channelName: channel.name,
        thumbnail: pickThumbnail(snippet.thumbnails),
      });
    }
  }

  matched.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return matched;
}
