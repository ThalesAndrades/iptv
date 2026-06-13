// Catálogo PRÓPRIO do operador — Filmes e Séries definidos por você em
// data/catalog.json. É infraestrutura neutra: você popula com conteúdo que tem
// direito de distribuir (domínio público, produção própria ou licenciado). O
// servidor apenas serve o que está no arquivo; a responsabilidade pelo direito
// do conteúdo é de quem opera.
//
// Schema (data/catalog.json):
// {
//   "movies": [
//     { "id","title","year","plot","poster","category","url","container" }
//   ],
//   "series": [
//     { "id","title","year","plot","poster","category",
//       "seasons": [ { "season", "episodes": [ { "ep","title","url","container","plot" } ] } ] }
//   ]
// }

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FILE = process.env.CATALOG_FILE || path.join(__dirname, '..', 'data', 'catalog.json')

let store = { movies: [], series: [], episodeById: new Map() }

function clean(v) {
  return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim()
}
function containerOf(url, given) {
  if (given) return String(given).toLowerCase()
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase()
  return ['mp4', 'm4v', 'ogv', 'mpeg', 'mpg', 'webm', 'mkv', 'ts', 'm3u8'].includes(ext) ? ext : 'mp4'
}

/** (Re)carrega e normaliza o catálogo do disco. Tolerante a arquivo ausente. */
function load() {
  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    raw = {}
  }

  const movies = (raw.movies || [])
    .filter(m => m && m.url && m.title)
    .map((m, i) => ({
      id: `own:m:${m.id || i}`,
      title: clean(m.title),
      year: parseInt(m.year, 10) || null,
      plot: clean(m.plot || ''),
      poster: m.poster || '',
      category: clean(m.category || 'Geral'),
      url: String(m.url),
      container: containerOf(m.url, m.container),
      source: 'own'
    }))

  const episodeById = new Map()
  let epSeq = 0
  const series = (raw.series || [])
    .filter(s => s && s.title)
    .map((s, si) => ({
      seriesId: si + 1,
      title: clean(s.title),
      year: parseInt(s.year, 10) || null,
      plot: clean(s.plot || ''),
      poster: s.poster || '',
      category: clean(s.category || 'Geral'),
      seasons: (s.seasons || []).map(se => ({
        season: parseInt(se.season, 10) || 1,
        episodes: (se.episodes || [])
          .filter(e => e && e.url)
          .map(e => {
            const epId = ++epSeq
            const container = containerOf(e.url, e.container)
            episodeById.set(epId, { url: String(e.url), container })
            return {
              epId,
              ep: parseInt(e.ep, 10) || 1,
              title: clean(e.title || `Episódio ${e.ep || 1}`),
              plot: clean(e.plot || ''),
              container
            }
          })
      }))
    }))

  store = { movies, series, episodeById }
  return { movies: movies.length, series: series.length }
}

load()

export default {
  movies: () => store.movies,
  series: () => store.series,
  episode: id => store.episodeById.get(Number(id)) || null,
  reload: load
}
