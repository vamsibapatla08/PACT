// Turns a Pact Pilot answer (markdown, links, lists) into words that sound right out loud, and fixes words speech to text often gets wrong.

const MAX_SPOKEN = 900

export function toSpoken(raw: string): string {
  let t = raw
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1') // [Hotel](https://...) -> Hotel
    .replace(/https?:\/\/\S+|www\.\S+/g, '') // bare links
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '') // list markers
    .replace(/~\s*(?=[$\d])/g, 'about ')
    .replace(/\/(night|person|day|head)\b/g, ' a $1')
    .replace(/[*_#`>|~]/g, '')
    .replace(/\s*\n+\s*/g, (gap, at, all) => (/[.!?:;,]$/.test(all.slice(0, at).trimEnd()) ? ' ' : '. ')) // a line break ends a thought
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length > MAX_SPOKEN) {
    const cut = t.slice(0, MAX_SPOKEN)
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    t = end > MAX_SPOKEN / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
  }
  return t
}

export function fixHeard(text: string): string {
  return text.trim().replace(/\b(?:pack|packed|packs|pacts)\s+pilot\b/gi, 'Pact Pilot')
}
