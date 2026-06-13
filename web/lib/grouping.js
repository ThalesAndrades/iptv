// Agrupamento por contexto, compartilhado pela playlist M3U e pela Xtream API.
//
// Regra (pedido do produto): canais do Brasil ficam separados por gênero
// ("🇧🇷 Brasil · Notícias"…); todo o resto vai para "🌎 Internacionais · {gênero}".
// Gêneros são traduzidos para PT-BR quando conhecidos.

// Tradução dos slugs de categoria do iptv-org para PT-BR.
const GENRE_PT = {
  animation: 'Animação',
  auto: 'Automóveis',
  business: 'Negócios',
  classic: 'Clássicos',
  comedy: 'Comédia',
  cooking: 'Culinária',
  culture: 'Cultura',
  documentary: 'Documentários',
  education: 'Educação',
  entertainment: 'Entretenimento',
  family: 'Família',
  general: 'Geral',
  kids: 'Infantil',
  legislative: 'Legislativo',
  lifestyle: 'Estilo de Vida',
  movies: 'Filmes',
  music: 'Música',
  news: 'Notícias',
  outdoor: 'Aventura',
  relax: 'Relax',
  religious: 'Religioso',
  science: 'Ciência',
  series: 'Séries',
  shop: 'Compras',
  sports: 'Esportes',
  travel: 'Viagem',
  weather: 'Clima',
  xxx: 'Adulto'
}

/** True se o stream é de um canal brasileiro. */
export function isBrazil(s) {
  return s?.country?.code === 'BR'
}

/** Nome do gênero (PT-BR) do stream, ou "Outros". */
export function genreLabel(s) {
  const cat = s?.categories?.[0]
  if (!cat) return 'Outros'
  return GENRE_PT[cat.id] || cat.name || 'Outros'
}

/** Rótulo de contexto: "🇧🇷 Brasil · {gênero}" ou "🌎 Internacionais · {gênero}". */
export function contextLabel(s) {
  const region = isBrazil(s) ? '🇧🇷 Brasil' : '🌎 Internacionais'
  return `${region} · ${genreLabel(s)}`
}

export default { isBrazil, genreLabel, contextLabel }
