// GitHub Pages 프로젝트 사이트는 도메인 루트가 아니라 /레포이름/ 하위에서 서빙되므로,
// 맨앞에 '/'가 붙은 절대경로는 도메인 루트 기준으로 해석되어 깨진다. 반드시 상대경로를 쓴다.
const DATA_URL = 'data/videos.json';

async function loadVideos() {
  const statusEl = document.getElementById('status');
  const listEl = document.getElementById('video-list');
  const updatedAtEl = document.getElementById('updated-at');

  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`데이터 로드 실패 (${res.status})`);
    const data = await res.json();

    updatedAtEl.textContent = data.updatedAt ? `마지막 갱신: ${formatDateTime(data.updatedAt)}` : '';

    const videos = data.videos ?? [];
    if (videos.length === 0) {
      statusEl.textContent = '조건에 맞는 영상이 아직 없습니다.';
      listEl.innerHTML = '';
      return;
    }

    statusEl.textContent = `총 ${videos.length}건`;
    listEl.innerHTML = '';
    for (const video of videos) {
      listEl.appendChild(createVideoCard(video));
    }
  } catch (err) {
    statusEl.textContent = `데이터를 불러오지 못했습니다: ${err.message}`;
  }
}

function createVideoCard(video) {
  const li = document.createElement('li');
  li.className = 'video-card';

  const thumb = document.createElement('img');
  thumb.className = 'video-card__thumb';
  thumb.src = video.thumbnail;
  thumb.alt = video.title;
  thumb.loading = 'lazy';
  li.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'video-card__body';

  const title = document.createElement('h2');
  title.className = 'video-card__title';
  title.textContent = video.title;
  body.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'video-card__meta';
  meta.textContent = `${video.channelName} · ${formatPublishedAt(video.publishedAt)}`;
  body.appendChild(meta);

  const summaryPanel = document.createElement('div');
  summaryPanel.className = 'video-card__summary';
  summaryPanel.innerHTML = video.summary ? renderSummaryHtml(video.summary) : '';

  const actions = document.createElement('div');
  actions.className = 'video-card__actions';
  actions.appendChild(createSummaryButton(video, summaryPanel));
  actions.appendChild(createWatchButton(video));
  body.appendChild(actions);
  body.appendChild(summaryPanel);

  li.appendChild(body);
  return li;
}

function createSummaryButton(video, summaryPanel) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--primary';

  const isReady = video.transcriptStatus === 'ok' && video.summary;
  if (!isReady) {
    btn.textContent = '준비 중';
    btn.disabled = true;
    return btn;
  }

  btn.textContent = '주요내용';
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    const isOpen = summaryPanel.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(isOpen));
  });
  return btn;
}

function createWatchButton(video) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--secondary';
  btn.textContent = '영상보기';
  btn.addEventListener('click', () => {
    window.open(`https://www.youtube.com/watch?v=${video.videoId}`, '_blank', 'noopener');
  });
  return btn;
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineFormat(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Gemini 요약 결과(SUMSUM.md 지침에 따라 제목/굵게/목록/구분선 등 마크다운 형식으로 옴)를
// 최소한으로 안전하게 HTML로 변환한다. 전체를 먼저 escape한 뒤 고정된 태그로만
// 조립하므로, 텍스트 내용에 의한 삽입 위험은 없다.
function renderSummaryHtml(markdown) {
  const lines = escapeHtml(markdown).split('\n');
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const openList = (type) => {
    if (listType !== type) {
      closeList();
      html.push(`<${type}>`);
      listType = type;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '') continue;

    if (line === '---') {
      closeList();
      html.push('<hr>');
      continue;
    }

    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    const quote = line.match(/^&gt;\s?(.*)/);
    const bullet = line.match(/^[-*]\s+(.*)/);
    const ordered = line.match(/^\d+\.\s+(.*)/);

    if (h1) {
      closeList();
      html.push(`<h3>${inlineFormat(h1[1])}</h3>`);
    } else if (h2) {
      closeList();
      html.push(`<h4>${inlineFormat(h2[1])}</h4>`);
    } else if (quote) {
      closeList();
      html.push(`<blockquote>${inlineFormat(quote[1])}</blockquote>`);
    } else if (bullet) {
      openList('ul');
      html.push(`<li>${inlineFormat(bullet[1])}</li>`);
    } else if (ordered) {
      openList('ol');
      html.push(`<li>${inlineFormat(ordered[1])}</li>`);
    } else {
      closeList();
      html.push(`<p>${inlineFormat(line)}</p>`);
    }
  }
  closeList();
  return html.join('');
}

function formatPublishedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timePart = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} ${timePart}`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ko-KR');
}

loadVideos();
