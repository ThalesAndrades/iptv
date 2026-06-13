// Coordenador de VOD/Séries: combina o catálogo PRÓPRIO (lib/catalog.js, o seu)
// com o acervo de DOMÍNIO PÚBLICO (lib/vod.js, Internet Archive) e expõe tudo no
// formato da Xtream Codes API. stream_id/series_id são índices estáveis dentro
// de uma versão do catálogo; a resolução de reprodução volta pelos mesmos
// índices (rotas /movie e /series no server.js).

import catalog from './catalog.js'
import vod from './vod.js'

/** Filmes combinados: o seu catálogo primeiro, depois o acervo livre. */
function movies() {
  return [...catalog.movies(), ...vod.list()]
}

/** Constrói a lista de categorias (rótulos únicos) com id numérico estável. */
function buildCategories(labels) {
  const uniq = [...new Set(labels)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return uniq.map((label, i) => ({ id: String(i + 1), label }))
}

// ---- Filmes (VOD) ----------------------------------------------------------

function vodCategories() {
  const cats = buildCategories(movies().map(m => `🎬 ${m.category}`))
  return cats.map(c => ({ category_id: c.id, category_name: c.label, parent_id: 0 }))
}

function vodStreams(categoryId) {
  const all = movies()
  const idByLabel = new Map(buildCategories(all.map(m => `🎬 ${m.category}`)).map(c => [c.label, c.id]))
  const out = []
  all.forEach((m, idx) => {
    const catId = idByLabel.get(`🎬 ${m.category}`) || '1'
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

function vodInfo(vodId) {
  const m = movies()[parseInt(vodId, 10) - 1]
  if (!m) return { info: {}, movie_data: {} }
  return {
    info: {
      movie_image: m.poster,
      cover_big: m.poster,
      plot: m.plot,
      description: m.plot,
      releasedate: m.year ? `${m.year}` : '',
      genre: m.category,
      rating: '',
      duration: ''
    },
    movie_data: { stream_id: parseInt(vodId, 10), name: m.title, container_extension: m.container }
  }
}

/** URL de reprodução de um filme (vod stream_id), ou null. */
function vodResolve(streamId) {
  return movies()[parseInt(streamId, 10) - 1]?.url || null
}

// ---- Séries ----------------------------------------------------------------

function seriesCategories() {
  const cats = buildCategories(catalog.series().map(s => `📺 ${s.category}`))
  return cats.map(c => ({ category_id: c.id, category_name: c.label, parent_id: 0 }))
}

function seriesList(categoryId) {
  const all = catalog.series()
  const idByLabel = new Map(buildCategories(all.map(s => `📺 ${s.category}`)).map(c => [c.label, c.id]))
  const out = []
  all.forEach(s => {
    const catId = idByLabel.get(`📺 ${s.category}`) || '1'
    if (categoryId && String(categoryId) !== String(catId)) return
    out.push({
      num: s.seriesId,
      name: s.year ? `${s.title} (${s.year})` : s.title,
      series_id: s.seriesId,
      cover: s.poster,
      plot: s.plot,
      genre: s.category,
      releaseDate: s.year ? `${s.year}` : '',
      rating: '',
      rating_5based: 0,
      category_id: catId
    })
  })
  return out
}

function seriesInfo(seriesId) {
  const s = catalog.series().find(x => String(x.seriesId) === String(seriesId))
  if (!s) return { info: {}, seasons: [], episodes: {} }
  const episodes = {}
  for (const se of s.seasons) {
    episodes[String(se.season)] = se.episodes.map(e => ({
      id: String(e.epId),
      episode_num: e.ep,
      title: e.title,
      container_extension: e.container,
      info: { plot: e.plot, duration: '' }
    }))
  }
  return {
    info: { name: s.title, cover: s.poster, plot: s.plot, genre: s.category, releaseDate: s.year ? `${s.year}` : '' },
    seasons: s.seasons.map(se => ({ season_number: se.season, name: `Temporada ${se.season}` })),
    episodes
  }
}

/** URL de reprodução de um episódio (id do episódio), ou null. */
function episodeResolve(epId) {
  return catalog.episode(epId)?.url || null
}

export default {
  vodCategories,
  vodStreams,
  vodInfo,
  vodResolve,
  seriesCategories,
  seriesList,
  seriesInfo,
  episodeResolve
}
