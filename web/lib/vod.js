// VOD (Filmes) a partir do Internet Archive — acervo de DOMÍNIO PÚBLICO, legal e
// gratuito. Nada de conteúdo protegido. O catálogo é montado em segundo plano
// (inspeciona itens, escolhe o melhor arquivo de vídeo, pula os "stubs" sem
// vídeo) e cacheado; o stream é servido por REDIRECT à URL do Internet Archive
// (não hospedamos nem reencaminhamos os GBs — poupa banda).

const IA_SEARCH = 'https://archive.org/advancedsearch.php'
const IA_META = 'https://archive.org/metadata'
const IA_DL = 'https://archive.org/download'
const IA_THUMB = 'https://archive.org/services/img'

const ENABLED = process.env.VOD_ENABLED !== '0'
const QUERY = process.env.VOD_IA_QUERY || 'collection:(feature_films) AND mediatype:(movies)'
const TARGET = Math.min(parseInt(process.env.VOD_MAX || '120', 10) || 120, 400)
const CANDIDATES = Math.max(TARGET * 3, 300)
const CONCURRENCY = 6
const BUILD_BUDGET_MS = 35_000
const FETCH_TIMEOUT_MS = 12_000
const TTL_MS = 12 * 60 * 60 * 1000 // 12 h

// Formatos de vídeo do IA, em ordem de preferência.
const VIDEO_FORMATS = ['h.264', 'MPEG4', 'h.264 IA', 'HiRes MPEG4', '512Kb MPEG4', 'MPEG2', 'Ogg Video']
const ADULT_RE = /\b(sex|porn|xxx|nude|nudist|erotic|erótic|playboy)\b/i

let cache = { at: 0, movies: null }
let building = false

function clean(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim()
}

async function fetchJson(url) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Busca candidatos (id, título, ano, sinopse) no Internet Archive. */
async function fetchCandidates() {
  const fields = ['identifier', 'title', 'year', 'description']
  const q = new URLSearchParams({ q: QUERY, rows: String(CANDIDATES), page: '1', output: 'json' })
  for (const f of fields) q.append('fl[]', f)
  q.append('sort[]', 'downloads desc')
  const data = await fetchJson(`${IA_SEARCH}?${q.toString()}`)
  const docs = data?.response?.docs || []
  return docs.filter(d => d.identifier && d.title && !ADULT_RE.test(String(d.title)))
}

/** Escolhe o melhor arquivo de vídeo de um item (ou null). */
function pickVideoFile(files) {
  const vids = (files || []).filter(f => {
    const name = String(f.name || '').toLowerCase()
    return (
      VIDEO_FORMATS.includes(f.format) ||
      name.endsWith('.mp4') ||
      name.endsWith('.m4v') ||
      name.endsWith('.ogv')
    )
  })
  if (!vids.length) return null
  vids.sort((a, b) => {
    const pa = VIDEO_FORMATS.indexOf(a.format)
    const pb = VIDEO_FORMATS.indexOf(b.format)
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
  })
  return vids[0].name
}

function containerOf(fileName) {
  const ext = String(fileName).split('.').pop().toLowerCase()
  return ['mp4', 'm4v', 'ogv', 'mpeg', 'mpg', 'webm'].includes(ext) ? ext : 'mp4'
}

/** Inspeciona um candidato; retorna o filme normalizado ou null (stub/sem vídeo). */
async function inspect(doc) {
  const meta = await fetchJson(`${IA_META}/${encodeURIComponent(doc.identifier)}`)
  const file = pickVideoFile(meta?.files)
  if (!file) return null
  const desc = Array.isArray(doc.description) ? doc.description[0] : doc.description
  const year = parseInt(Array.isArray(doc.year) ? doc.year[0] : doc.year, 10) || null
  return {
    id: doc.identifier,
    title: clean(Array.isArray(doc.title) ? doc.title[0] : doc.title),
    year,
    plot: clean(desc).replace(/<[^>]+>/g, '').slice(0, 600),
    poster: `${IA_THUMB}/${encodeURIComponent(doc.identifier)}`,
    file,
    container: containerOf(file)
  }
}

/** Monta o catálogo: inspeciona candidatos com concorrência limitada e budget. */
async function buildCatalog() {
  const candidates = await fetchCandidates()
  const movies = []
  const deadline = Date.now() + BUILD_BUDGET_MS
  let i = 0

  async function worker() {
    while (i < candidates.length && movies.length < TARGET && Date.now() < deadline) {
      const doc = candidates[i++]
      const movie = await inspect(doc)
      if (movie) movies.push(movie)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return movies
}

/** Catálogo cacheado (12 h); dispara build em segundo plano se vencido. */
function getCatalog() {
  if (!ENABLED) return []
  const fresh = cache.movies && Date.now() - cache.at < TTL_MS
  if (!fresh && !building) {
    building = true
    buildCatalog()
      .then(movies => {
        if (movies.length) cache = { at: Date.now(), movies }
      })
      .catch(() => {})
      .finally(() => {
        building = false
      })
  }
  return cache.movies || []
}

function decadeOf(year) {
  if (!year) return 'Clássicos'
  return `${Math.floor(year / 10) * 10}s`
}

/** Categorias de VOD (por década), Xtream-style. */
function categories() {
  const movies = getCatalog()
  const labels = [...new Set(movies.map(m => decadeOf(m.year)))].sort()
  return labels.map((label, i) => ({
    category_id: String(i + 1),
    category_name: `🎬 Filmes · ${label}`,
    parent_id: 0
  }))
}

function categoryIdByLabel() {
  const movies = getCatalog()
  const labels = [...new Set(movies.map(m => decadeOf(m.year)))].sort()
  return new Map(labels.map((label, i) => [label, String(i + 1)]))
}

/** Lista de filmes (Xtream get_vod_streams), opcionalmente por categoria. */
function streams(categoryId) {
  const movies = getCatalog()
  const idByLabel = categoryIdByLabel()
  const out = []
  movies.forEach((m, idx) => {
    const catId = idByLabel.get(decadeOf(m.year)) || '1'
    if (categoryId && String(categoryId) !== String(catId)) return
    out.push({
      num: idx + 1,
      name: m.year ? `${m.title} (${m.year})` : m.title,
      title: m.title,
      stream_type: 'movie',
      stream_id: idx + 1,
      stream_icon: m.poster,
      rating: '',
      rating_5based: 0,
      added: '0',
      category_id: catId,
      container_extension: m.container,
      custom_sid: '',
      direct_source: ''
    })
  })
  return out
}

/** Detalhe de um filme (Xtream get_vod_info). */
function info(vodId) {
  const movies = getCatalog()
  const m = movies[parseInt(vodId, 10) - 1]
  if (!m) return { info: {}, movie_data: {} }
  return {
    info: {
      movie_image: m.poster,
      cover_big: m.poster,
      plot: m.plot,
      description: m.plot,
      releasedate: m.year ? `${m.year}` : '',
      rating: '',
      duration: '',
      genre: 'Domínio Público'
    },
    movie_data: {
      stream_id: parseInt(vodId, 10),
      name: m.title,
      container_extension: m.container
    }
  }
}

/** URL de reprodução (Internet Archive) para um vod stream_id, ou null. */
function resolve(streamId) {
  const movies = getCatalog()
  const m = movies[parseInt(streamId, 10) - 1]
  if (!m) return null
  return `${IA_DL}/${encodeURIComponent(m.id)}/${encodeURIComponent(m.file)}`
}

/** Dispara o build do catálogo (uso na inicialização). */
function prime() {
  if (ENABLED) getCatalog()
}

export default { categories, streams, info, resolve, prime, enabled: ENABLED }
