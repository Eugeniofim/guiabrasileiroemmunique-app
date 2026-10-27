/* =====================================================
   O KIT DA VIAGEM — Guia Brasileiro em Munique (27/10/2026)

   Este app não tem voucher à parte: o KIT É O VOUCHER. Quem reservou recebe
   UM link (ou o PDF) com tudo, em ordem de data: o código de cada passeio
   (o voucher), dia e horário, ponto de encontro, o programa (paradas),
   incluso e não incluso, o que levar, o pagamento (pago e o que falta),
   "pôr na minha agenda", dicas para Munique (ele edita) e o contato.
   NUNCA o e-mail ou o telefone do cliente.
   Painel básico (pedido dele): só o botão "Kit da viagem (voucher)" em cada
   reserva confirmada e a tela do kit — nada de aba nova.

   O formato é o JSON v1 do contrato do kit (o mesmo que a função "avisos" do
   servidor monta para o e-mail do cliente) — não mudar os nomes dos campos.
   UM link por CLIENTE: chave = (email || whats || name) em minúsculas.

   O LINK CURTO E SEMPRE ATUALIZADO (#/k/<código>): o kit fica numa tabela só
   dele no banco (mario.kits — LIGAR-KIT-MARIO.sql). O cliente lê UM kit pelo
   código (função mario.kit), nunca a tabela; só o dono grava. Mudou o horário
   ou um pagamento → o app republica sozinho e o cliente vê no mesmo link.
   Sem a tabela (ou sem login), cai no link COMPRIDO (#/kt/…, o kit viaja
   dentro do link): funciona, mas não se atualiza.
   Os códigos ficam em DB.privado.kits[chave] = {token, criado, publicado}
   (privado: sobe linha a linha pela tabela itens, nunca no appstate público;
   é onde o servidor procura o link curto para o e-mail de confirmação).

   Kit.dados(chave) · Kit.link(chave) → url · Kit.mensagem(chave) → texto
   Kit.abrir(chave) · Kit.urlConhecida(chave) (o curto, se já existe — para o lembrete)
   ===================================================== */
'use strict';

/* só o que é certo para qualquer viajante em Munique — ele edita no próprio kit */
const KIT_DICAS_PADRAO = [
  'Emergência: 112 (ambulância e bombeiros). Polícia: 110.',
  'A moeda é o euro. Cartão é aceito em muitos lugares, mas leve um pouco de dinheiro: alguns cafés e lojas pequenas só aceitam dinheiro.',
  'Tomada: a europeia, de dois pinos redondos.',
  'Do aeroporto ao centro: os trens S1 e S8.',
  'No metrô, no trem, no bonde e no ônibus não há catraca, mas a fiscalização é frequente: o bilhete de papel se carimba na maquininha antes de embarcar.',
  'Aos domingos e feriados quase todo o comércio fecha, inclusive os supermercados.',
  'A água da torneira é potável.',
];
const KIT_LEVAR = {
  walk: ['Sapato confortável: é uma caminhada', 'Roupa para o tempo do dia (um casaco leve ou capa de chuva ajudam)', 'Garrafinha de água'],
  carro: ['Documento com foto', 'Água e um lanche para o caminho', 'Celular carregado e este kit'],
  day: ['Documento com foto', 'Sapato confortável', 'Água e um lanche para o caminho'],
  outro: ['Documento com foto', 'Celular carregado e este kit'],
};
const KIT_ARTIGO = 'o';   /* "Sua viagem com o Mario" */
const kitDicas = () => (Array.isArray(DB.settings.kitDicas) ? DB.settings.kitDicas : KIT_DICAS_PADRAO).map(x => String(x || '').trim()).filter(Boolean);
const kitChaveDe = (b) => String((b && (b.email || b.whats || b.name)) || '').toLowerCase();
const kitPrim = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const kitDig = (w) => String(w || '').replace(/\D/g, '');
const kitPt = (a) => !a ? '' : typeof a === 'string' ? a.trim() : String(a.pt || a.en || '').trim();
const kitLista = (a) => (a && (a.pt || a.en) ? (a.pt || a.en) : Array.isArray(a) ? a : []).map(s => String(s || '').trim()).filter(Boolean);
/* "09:30", "9h30", "10:00–13:00" → o começo em HH:MM */
function kitHm(t) { const m = String(t || '').match(/(\d{1,2})\s*[:hH]\s*(\d{2})?/); return m ? String(Math.min(23, +m[1])).padStart(2, '0') + ':' + String(Math.min(59, +(m[2] || 0))).padStart(2, '0') : ''; }
const kitMin = (hm) => { const m = String(hm || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : 0; };
const kitDurMin = (txt) => { const m = String(txt || '').match(/(\d+)\s*h/); return m ? Math.min(720, +m[1] * 60) : 120; };
/* o endereço oficial dele (o link vai para o cliente — nunca o endereço antigo nem o de teste) */
const kitBase = () => /guiabrasileiroemmunique\.app|rottaguide\.com\/mariodalpra|guia\.eugeniofim\.com\/mario\//.test(location.href) ? 'https://guiabrasileiroemmunique.app/' : Publico.base();
function kitData(iso, opts) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, opts || {}));
}
const kitCap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
function kitPeriodo(sv) {
  if (!sv.length) return '';
  const a = sv[0].data, b = sv[sv.length - 1].data;
  const f = (iso, ano) => new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', Object.assign({ day: 'numeric', month: 'long' }, ano ? { year: 'numeric' } : {}));
  return a === b ? f(a, true) : f(a, false) + ' a ' + f(b, true);
}
/* foto enviada pelo painel vira data: dentro do passeio — grande demais para ir no link */
const kitFoto = (p) => { p = String(p || ''); return /^data:/.test(p) && p.length > 300000 ? '' : p; };

/* as reservas do cliente que entram no kit: as que estão por vir (e as de ontem); se a viagem já passou, as últimas 3 */
function kitReservas(chave) {
  const vistos = new Set();
  const todas = DB.bookings.filter(b => b && b.status === 'confirmed' && kitChaveDe(b) === chave && !vistos.has(b.id) && vistos.add(b.id))
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const desde = addDays(isoToday(), -1), vivas = todas.filter(b => b.date >= desde);
  return vivas.length ? vivas : todas.slice(-3);
}
function kitServico(b) {
  const x = Tours.get(b.tourId) || {};
  const pago = Bookings.paid(b), restante = Bookings.due(b);
  /* os horários dele são faixas ("10:00–13:00"): o começo vai em hora, o fim dá a duração na agenda */
  const faixa = String(b.time || '').match(/(\d{1,2}[:hH]\d{2})\s*(?:[–-]|às|a)\s*(\d{1,2}[:hH]\d{2})/);
  const durFaixa = faixa ? kitMin(kitHm(faixa[2])) - kitMin(kitHm(faixa[1])) : 0;
  const s = {
    code: b.code, nome: kitPt(x.name) || b.tourName || 'Passeio', tipo: x.type || '',
    data: b.date, hora: kitHm(b.time) || String(b.time || ''), pessoas: +b.pax || 1,
    duracao: String(x.duration || '') || (faixa ? 'até ' + kitHm(faixa[2]) : ''),
    durMin: durFaixa > 0 ? durFaixa : kitDurMin(x.duration),
    encontro: kitPt(x.meeting), hotel: '', guia: typeof guiaNome === 'function' ? guiaNome() : '', foto: kitFoto(x.photo),
    fotoCr: x.photoCr || '',   /* foto com licença que pede crédito: o crédito vai junto */
    resumo: kitPt(x.tagline),
    paradas: (x.stops || []).map(p => ({ n: kitPt(p.n), d: kitPt(p.d) })).filter(p => p.n).slice(0, 12),
    inclui: kitLista(x.includes), naoInclui: kitLista(x.notIncludes),
    levar: KIT_LEVAR[x.type] || KIT_LEVAR.outro,
    pago, restante, cancel: kitPt(x.cancel),
  };
  if (restante > 0 && typeof Bookings.dueDate === 'function') { const v = Bookings.dueDate(b); if (v >= isoToday()) s.vence = v; }
  return s;
}
/* o kit inteiro (é ISTO que vai para o cliente: sem e-mail nem telefone dele) */
async function kitDados(chave) {
  const bs = kitReservas(chave); if (!bs.length) return null;
  const sv = bs.map(kitServico), st = DB.settings;
  return { v: 1, nome: bs[bs.length - 1].name || '', periodo: kitPeriodo(sv), servicos: sv, dicas: kitDicas(), parceiros: [],
    brindes: [], roteiro: '',
    whats: kitDig(st.whats), email: (typeof GUIA_CFG !== 'undefined' && GUIA_CFG.email) || '', insta: String(st.insta || '').replace(/^@/, ''),
    negocio: (typeof guiaNegocio === 'function' && guiaNegocio()) || 'Guia Brasileiro em Munique', gerado: new Date().toISOString() };
}
/* o do link comprido: sem as descrições das paradas e sem foto enviada pelo painel (link menor) */
function kitEnxuto(d) {
  const o = JSON.parse(JSON.stringify(d));
  o.servicos.forEach(s => { s.paradas = s.paradas.map(p => ({ n: p.n })); if (/^data:/.test(s.foto || '')) s.foto = ''; });
  delete o.roteiro; return o;
}

/* ---------- o link: curto (tabela) ou comprido (dentro do link) ---------- */
function kitTokens() { DB.privado = DB.privado || {}; if (!DB.privado.kits || typeof DB.privado.kits !== 'object') DB.privado.kits = {}; return DB.privado.kits; }
function kitNovoToken() {
  const A = 'ACDEFGHJKMNPQRTUVWXYabcdefghjkmnpqrstuvwxyz34679', u = new Uint8Array(10);
  (window.crypto || {}).getRandomValues ? crypto.getRandomValues(u) : u.forEach((_, i) => { u[i] = Math.random() * 256; });
  return [...u].map(n => A[n % A.length]).join('');
}
const kitPodeNuvem = () => typeof temNuvem === 'function' && temNuvem() && typeof isLoggedIn === 'function' && isLoggedIn() && !Kit.semTabela;
async function kitPublica(chave, dados) {
  if (!kitPodeNuvem()) return false;
  const T = kitTokens(); let t = T[chave];
  if (!t || !t.token) { t = T[chave] = { token: kitNovoToken(), criado: new Date().toISOString() }; save(); }
  try {
    const r = await supaFetch('kits', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ token: t.token, dados, atualizado_em: new Date().toISOString() }) });
    if (r.status === 404 || r.status === 400) { const j = await r.json().catch(() => ({})); if (/kits|relation|schema cache|PGRST205/i.test(JSON.stringify(j))) Kit.semTabela = true; return false; }
    if (!r.ok && r.status !== 201 && r.status !== 204) return false;
    if (!t.publicado) { t.publicado = new Date().toISOString(); save(); }
    return true;
  } catch (e) { return false; }
}
const Kit = {
  semTabela: false,
  dados: kitDados,
  async link(chave) {
    const d = await kitDados(chave); if (!d) throw new Error('esse cliente ainda não tem reserva confirmada');
    if (await kitPublica(chave, d)) return kitBase() + '#/k/' + kitTokens()[chave].token;
    return kitBase() + '#/kt/' + await Publico.codifica(kitEnxuto(d));
  },
  urlConhecida(chave) { const t = (DB.privado && DB.privado.kits && DB.privado.kits[chave]) || null; return t && t.publicado ? kitBase() + '#/k/' + t.token : ''; },
  curto(chave) { return !!this.urlConhecida(chave); },
  /* a mensagem que ELE manda (primeira pessoa) */
  async mensagem(chave, url) {
    const d = await kitDados(chave); if (!d) throw new Error('esse cliente ainda não tem reserva confirmada');
    url = url || await this.link(chave);
    const n = d.servicos.length;
    return `Oi, ${kitPrim(d.nome)}! Tudo bem? 😊 Preparei o kit da sua viagem: ${n > 1 ? 'os vouchers dos ' + n + ' passeios, os horários' : 'o voucher, o horário'}, o ponto de encontro e tudo o que vocês precisam saber.\n${url}\n\nGuarde no celular: no dia, é só me mostrar o voucher. Qualquer dúvida, me chama aqui!`;
  },
  abrir(chave) { if (!chave) return; const h = location.hash.slice(1); if (h && !/^\/adm\/kit\//.test(h)) Kit._volta = h; go('/adm/kit/' + encodeURIComponent(chave)); },
  /* republica os kits já mandados quando a reserva muda (horário, pagamento, cancelamento) */
  _fila: new Set(), _t: null,
  agendar(chave) {
    if (!chave || !(DB.privado && DB.privado.kits && DB.privado.kits[chave])) return;
    this._fila.add(chave); clearTimeout(this._t);
    this._t = setTimeout(async () => { const l = [...this._fila]; this._fila.clear(); for (const c of l) { try { const d = await kitDados(c); if (d) await kitPublica(c, d); } catch (e) {} } }, 2500);
  },
};
window.Kit = Kit;

/* ---------- a agenda do cliente (.ics e Google) ---------- */
function kitFim(s) {
  const r = String(s.hora || '').match(/\d{1,2}[:hH]\d{2}\s*(?:[–-]|às|a)\s*(\d{1,2}[:hH]\d{2})/);
  if (r) return kitHm(r[1]);
  const t = Math.min(1439, kitMin(kitHm(s.hora) || '09:00') + (+s.durMin || 120));
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}
function kitGoogle(s, d) {
  const z = (iso, hm) => iso.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';
  const ini = kitHm(s.hora);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: s.nome + ' · ' + (d.negocio || 'Guia Brasileiro em Munique'),
    dates: ini ? z(s.data, ini) + '/' + z(s.data, kitFim(s)) : s.data.replace(/-/g, '') + '/' + addDays(s.data, 1).replace(/-/g, ''),
    ctz: 'Europe/Berlin', location: s.encontro || '', details: `Voucher ${s.code}${d.whats ? ' · WhatsApp +' + d.whats : ''}` });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function kitIcs(d) {
  const z = (iso, hm) => iso.replace(/-/g, '') + 'T' + hm.replace(':', '') + '00';
  const e = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ev = (d.servicos || []).map(s => { const ini = kitHm(s.hora); return ['BEGIN:VEVENT', 'UID:' + s.code + '@guiabrasileiroemmunique.app', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
    ini ? 'DTSTART;TZID=Europe/Berlin:' + z(s.data, ini) : 'DTSTART;VALUE=DATE:' + s.data.replace(/-/g, ''),
    ini ? 'DTEND;TZID=Europe/Berlin:' + z(s.data, kitFim(s)) : 'DTEND;VALUE=DATE:' + addDays(s.data, 1).replace(/-/g, ''),
    'SUMMARY:' + e(s.nome + ' · ' + (d.negocio || '')), 'LOCATION:' + e(s.encontro || ''), 'DESCRIPTION:' + e('Voucher ' + s.code),
    'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(s.nome), 'END:VALARM', 'END:VEVENT'].join('\r\n'); });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Guia Brasileiro em Munique//Kit//PT', ...ev, 'END:VCALENDAR'].join('\r\n');
}
function kitBaixaIcs(d) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([kitIcs(d)], { type: 'text/calendar' }));
  a.download = 'viagem-' + (kitPrim(d.nome) || 'munique').toLowerCase() + '.ics'; document.body.appendChild(a); a.click(); a.remove();
}
/* "No seu hotel ou em ponto combinado" não é lugar no mapa: o mapa só aparece com um ponto de verdade */
const kitTemLugar = (q) => !!String(q || '').trim() && !/seu hotel|sua hospedagem|ponto combinado|a combinar|combinamos/i.test(q);
const kitMapa = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q + ', München');

/* a marca dele: o azul da Baviera escurecido + o amarelo do Brasil (tokens.css), com leitura medida */
function kitCores() { return { n: '#163E70', a: '#F2C230', cta: '#F2C230', ctaI: '#111111', at: '#7A5A12' }; }

/* ---------- o documento (o mesmo no painel, na página do cliente e no PDF) ---------- */
function kitDocHtml(d) {
  const C = kitCores();
  const ic = { mapa: `<svg viewBox="0 0 24 24" fill="none" stroke="${C.n}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>`,
    cal: `<svg viewBox="0 0 24 24" fill="none" stroke="${C.n}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>` };
  const sv = d.servicos || [], guia = (typeof guiaNome === 'function' && guiaNome()) || '';
  const pagoT = sv.reduce((s, x) => s + (+x.pago || 0), 0), faltaT = sv.reduce((s, x) => s + (+x.restante || 0), 0);
  const quando = (s) => { const h = String(s.hora || '').trim(); if (!h) return ''; const r = h.match(/^(\d{1,2}[:hH]\d{2})\s*(?:[–-]|às|a)\s*(\d{1,2}[:hH]\d{2})/);
    return (r ? `das ${r[1]} às ${r[2]}` : `às ${h}`) + (s.duracao && !/conforme/i.test(s.duracao) ? ' · ' + s.duracao : ''); };
  const lista = (a) => Array.isArray(a) ? a : [];
  const servico = (s, k) => {
    const par = lista(s.paradas), inc = lista(s.inclui), nao = lista(s.naoInclui), lev = lista(s.levar), lugar = kitTemLugar(s.encontro) ? s.encontro : (s.hotel || '');
    return `<section class="kt-sv kt-bl" id="kt-sv-${k}">
      <div class="kt-svTopo">${s.foto ? `<img src="${esc(s.foto)}" alt="" loading="lazy">${s.fotoCr ? `<small class="kt-fcr">${esc(s.fotoCr)}</small>` : ''}` : ''}<div class="kt-dia"><small>${esc(kitCap(kitData(s.data, { weekday: 'short', day: undefined, month: undefined })).replace('.', ''))}</small><b>${esc(String(s.data || '').slice(8, 10))}</b><small>${esc(new Date(s.data + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''))}</small></div></div>
      <div class="kt-svCorpo">
        <div class="kt-cab"><p class="kt-eyebrow">${s.tipo === 'transfer' ? 'Transfer' : 'Passeio'}</p><div class="kt-cod"><small>Voucher</small><b>${esc(s.code)}</b></div></div>
        <h2>${esc(s.nome)}</h2>${s.resumo ? `<p class="kt-res">${esc(s.resumo)}</p>` : ''}
        <div class="kt-grade">
          <div><small>Quando</small><b>${esc(kitCap(kitData(s.data)))}</b>${quando(s) ? `<span>${esc(quando(s))}</span>` : ''}</div>
          <div><small>Pessoas</small><b>${esc(s.pessoas || 1)} ${+s.pessoas > 1 ? 'pessoas' : 'pessoa'}</b>${s.guia ? `<span>Guia: ${esc(s.guia)}</span>` : ''}</div>
          <div class="kt-lg"><small>Ponto de encontro</small><b>${esc(s.encontro || (guia ? `${kitCap(KIT_ARTIGO)} ${guia} confirma pelo WhatsApp` : 'Combinamos pelo WhatsApp'))}</b>${s.hotel ? `<span>Hospedagem: ${esc(s.hotel)}</span>` : ''}
            ${lugar ? `<a class="kt-lk" href="${esc(kitMapa(lugar))}" target="_blank" rel="noopener">${ic.mapa}Abrir no mapa</a>` : ''}</div>
        </div>
        ${par.length ? `<div class="kt-bl"><h3>O programa</h3><ol class="kt-par">${par.map(p => `<li><b>${esc(p.n)}</b>${p.d ? `<span>${esc(p.d)}</span>` : ''}</li>`).join('')}</ol></div>` : ''}
        ${inc.length || nao.length ? `<div class="kt-duas kt-bl">${inc.length ? `<div><h3>Incluso</h3><ul class="kt-ok">${inc.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}${nao.length ? `<div><h3>Não incluso</h3><ul class="kt-no">${nao.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}</div>` : ''}
        ${lev.length ? `<div class="kt-bl"><h3>O que levar</h3><ul class="kt-levar">${lev.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        ${(+s.pago || 0) > 0 || (+s.restante || 0) > 0 ? `<div class="kt-pg kt-bl"><div><small>Pago</small><b>${esc(eur(+s.pago || 0))}</b></div>${s.restante > 0 ? `<div class="resta"><small>${s.noDia ? 'Restante no dia' : 'Falta pagar'}</small><b>${esc(eur(s.restante))}</b><span>${s.noDia ? 'no dia do passeio' : s.vence ? 'até ' + esc(kitData(s.vence, { weekday: undefined })) : ''}</span></div>` : '<div><small>Situação</small><b>Tudo pago ✓</b></div>'}</div>
          ${s.pagarUrl ? `<a class="kt-cta kt-tela" href="${esc(s.pagarUrl)}">Pagar ${esc(eur(s.pagarValor || s.restante))} agora</a>` : ''}` : ''}
        ${s.data ? `<div class="kt-acs kt-tela"><a class="kt-lk" href="${esc(kitGoogle(s, d))}" target="_blank" rel="noopener">${ic.cal}Pôr no Google Agenda</a></div>` : ''}
        ${s.cancel ? `<p class="kt-fino">${esc(s.cancel)}</p>` : ''}
      </div></section>`;
  };
  const ind = lista(d.indicacoes).filter(x => x && x.titulo && x.url);
  const icInd = () => '';
  return `<article class="ktDoc" style="--kt-n:${C.n};--kt-a:${C.a};--kt-cta:${C.cta};--kt-ctai:${C.ctaI};--kt-at:${C.at}">
    <header class="kt-topo kt-bl"><img class="kt-selo" src="${esc(((typeof APP_CONFIG !== 'undefined' && APP_CONFIG.guia) || {}).logo || 'arte/logo-mario.png')}" alt="">
      <p class="kt-eyebrow">Sua viagem com ${KIT_ARTIGO} ${esc(guia)} · ${esc(d.negocio || '')}</p>
      <h1>${esc(d.nome || 'Sua viagem')}</h1>
      <p class="kt-per">${esc(d.periodo || '')} · ${sv.length} ${sv.length > 1 ? 'passeios' : 'passeio'}</p>
      <div class="kt-acsTopo kt-tela">${d.whats ? `<a class="kt-cta" href="${esc(waLink(`Olá, ${guia}! Sobre a minha viagem…`, d.whats))}" target="_blank" rel="noopener">${typeof ICONE_WA !== 'undefined' ? ICONE_WA : ''}WhatsApp ${KIT_ARTIGO === 'a' ? 'da' : 'do'} ${esc(guia)}</a>` : ''}<button type="button" class="kt-bt" data-kt-ics>Pôr tudo na minha agenda</button></div>
    </header>
    ${sv.length > 1 ? `<nav class="kt-lista kt-bl" aria-label="Os passeios da viagem">${sv.map((s, k) => `<a href="#kt-sv-${k}" data-kt-ir="${k}"><span class="kt-ld">${esc(String(s.data || '').slice(8, 10))}/${esc(String(s.data || '').slice(5, 7))}</span><b>${esc(s.nome)}</b><span>${esc(kitHm(s.hora) || '')}</span></a>`).join('')}</nav>` : ''}
    ${sv.length > 1 && (pagoT || faltaT) ? `<div class="kt-pg kt-tot kt-bl"><div><small>Total pago</small><b>${esc(eur(pagoT))}</b></div><div class="${faltaT > 0 ? 'resta' : ''}"><small>Falta</small><b>${esc(eur(faltaT))}</b></div></div>` : ''}
    ${sv.map(servico).join('')}
    ${d.roteiro ? `<section class="kt-box kt-bl"><h3>O seu roteiro personalizado</h3><a class="kt-cta" href="${esc(d.roteiro)}" target="_blank" rel="noopener">Abrir o roteiro</a></section>` : ''}
    ${lista(d.dicas).length ? `<section class="kt-box kt-bl"><h3>Dicas para Munique</h3><ul class="kt-levar">${d.dicas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
    ${lista(d.parceiros).length ? `<section class="kt-box kt-bl"><h3>Descontos dos parceiros</h3>${d.parceiros.map(p => `<div class="kt-parc"><i>${esc((+p.desconto || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }))}%</i><div><b>${esc(p.nome)}</b>${p.cat || p.como ? `<small>${esc([p.cat, p.como].filter(Boolean).join(' · '))}</small>` : ''}</div></div>`).join('')}</section>` : ''}
    ${ind.length ? `<section class="kt-box kt-bl"><h3>Indicações ${KIT_ARTIGO === 'a' ? 'da' : 'do'} ${esc(guia)} para a sua viagem</h3>${ind.map(x => `<a class="kt-ind" href="${esc(x.url)}" target="_blank" rel="${x.wa ? 'noopener' : 'noopener sponsored'}"><span class="kt-indIc">${icInd(x.tipo)}</span><span><b>${esc(x.titulo)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></a>`).join('')}</section>` : ''}
    ${lista(d.brindes).length ? `<section class="kt-box kt-bl"><h3>Presentes para você</h3>${d.brindes.map(b => `<a class="kt-lk" href="${esc(b.url)}" target="_blank" rel="noopener">📎 ${esc(b.titulo)}</a>`).join('')}</section>` : ''}
    <footer class="kt-pe kt-bl"><div class="kt-qr" data-kt-qr></div>
      <div><b>No dia, é só mostrar o voucher</b><span>No celular ou impresso. O código de cada passeio está no topo dele.</span>
        <span class="kt-cont">${d.whats ? `WhatsApp ${KIT_ARTIGO === 'a' ? 'da' : 'do'} ${esc(guia)}: +${esc(d.whats)}` : ''}${d.email ? ` · ${esc(d.email)}` : ''}${d.insta ? ` · @${esc(d.insta)}` : ''}</span></div></footer>
  </article>`;
}
function kitLiga(raiz, d, url) {
  if (!raiz) return;
  const b = raiz.querySelector('[data-kt-ics]'); if (b) b.onclick = () => { kitBaixaIcs(d); toast('Agenda baixada: abra o arquivo para pôr tudo no celular'); };
  raiz.querySelectorAll('[data-kt-ir]').forEach(a => a.onclick = (e) => { e.preventDefault(); const el = raiz.querySelector('#kt-sv-' + a.dataset.ktIr); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const q = raiz.querySelector('[data-kt-qr]'); if (q && url && typeof qrSvg === 'function') q.innerHTML = qrSvg(url, { tamanho: 110, alt: 'QR code do kit da viagem' }) || '';
}

/* ---------- a página do cliente ---------- */
window.ROTAS_EXTRA = window.ROTAS_EXTRA || {};
/* o kit que o SERVIDOR monta (e-mail de recibo) vem sem dicas, sem "o que levar" e sem guia:
   completa com o que o app sabe (os Ajustes dele são públicos). O que ele mudou de propósito fica como ele deixou. */
function kitCompleta(d) {
  d = Object.assign({}, d);
  if ((!Array.isArray(d.dicas) || !d.dicas.length) && !Array.isArray(DB.settings.kitDicas)) d.dicas = KIT_DICAS_PADRAO.slice();
  d.servicos = (d.servicos || []).map(s => Object.assign({}, s, {
    levar: Array.isArray(s.levar) && s.levar.length ? s.levar : (KIT_LEVAR[s.tipo] || KIT_LEVAR.outro),
    guia: s.guia || ((typeof guiaNome === 'function' && guiaNome()) || ''),
    fotoCr: s.fotoCr || (s.foto ? ((DB.tours || []).find(t => t && t.photo === s.foto) || {}).photoCr || '' : ''),
  }));
  return d;
}
function kitPaginaCliente(d, url) {
  kitCss();
  d = kitCompleta(d);
  const g = (typeof guiaNome === 'function' && guiaNome()) || '';
  paginaPublica('Sua viagem · ' + (d.nome || d.negocio || 'Guia Brasileiro em Munique'), kitDocHtml(d), { rodape: `Guarde este link no celular. Qualquer dúvida, fale com ${KIT_ARTIGO} ${g} no WhatsApp.`, waTexto: `Olá, ${g}! Sobre a minha viagem…` });
  kitLiga(document.getElementById('pubPrint'), d, url || location.href);
}
/* o curto: lê o kit no banco pelo código */
ROTAS_EXTRA['k'] = async (partes) => {
  const tok = String((partes || [])[0] || '').replace(/[^A-Za-z0-9]/g, '');
  if (!tok) return paginaPublicaErro();
  app.innerHTML = '<main class="wrap"><p class="why center" style="margin-top:40px">Abrindo a sua viagem…</p></main>';
  try {
    const r = await supaFetch('rpc/kit', { method: 'POST', body: JSON.stringify({ p_token: tok }) });
    const d = r.ok ? await r.json() : null;
    if (!d || !d.servicos) return paginaPublicaErro(`Este link de viagem não existe mais. Peça um novo para ${KIT_ARTIGO} ${guiaNome()} pelo WhatsApp.`);
    kitPaginaCliente(d, location.href);
  } catch (e) { paginaPublicaErro('Sem internet para abrir a sua viagem. Tente de novo em instantes.'); }
};
/* o comprido: o kit veio dentro do link (é o que o e-mail do servidor manda) */
ROTAS_EXTRA['kt'] = (partes) => abrePublico(partes, (d) => kitPaginaCliente(d, location.href));

/* ---------- a tela do painel: #/adm/kit/<chave> ---------- */
const kitEstadoTxt = (chave) => Kit.curto(chave) ? '✓ Link curto e sempre atualizado: o cliente vê as mudanças no mesmo link.'
  : kitPodeNuvem() ? 'O link curto nasce quando você mandar ou copiar.'
  : Kit.semTabela ? 'Link comprido: funciona, mas não se atualiza sozinho (o link curto ainda não foi ligado no banco — fale com o Eugênio).'
  : 'Link comprido (sem login ou sem nuvem): funciona, mas não se atualiza sozinho.';
async function admKit(chave) {
  kitCss();
  const d = await kitDados(chave);
  if (!d) { toast('Esse cliente ainda não tem reserva confirmada'); go(Kit._volta || '/adm/bookings'); return; }
  const fone = kitDig((kitReservas(chave).slice(-1)[0] || {}).whats);
  document.title = 'Viagem - ' + (d.nome || 'cliente');
  const voltar = Kit._volta ? '#' + Kit._volta : '#/adm/bookings';
  app.innerHTML = `<div class="ktTela">
    <div class="ktBarra"><a class="mini" href="${esc(voltar)}">← voltar</a>
      <span class="ktBts"><button class="mini" id="ktCopia">Copiar link</button><button class="mini" id="ktZap">${fone.length >= 8 ? 'Mandar no WhatsApp' : 'Mandar no WhatsApp (escolher contato)'}</button><button class="cta sm" id="ktPdf">Gerar PDF</button></span></div>
    <p class="ktEstado"><b>Kit da viagem = o voucher do cliente.</b> <span id="ktEstado">${esc(kitEstadoTxt(chave))}</span></p>
    <div id="ktPrint">${kitDocHtml(d)}</div>
    <section class="card ktDicasEd"><h3>Dicas para Munique</h3><p class="why">Vão em todo kit. Uma por linha.</p>
      <textarea id="ktDicasTx" rows="7">${esc(kitDicas().join('\n'))}</textarea>
      <div class="ktBts" style="margin-top:8px"><button class="cta sm" id="ktDicasOk">Salvar as dicas</button><button class="mini" id="ktDicasPadrao">Voltar às dicas padrão</button></div></section>
  </div>`;
  const url0 = Kit.urlConhecida(chave);
  kitLiga(document.getElementById('ktPrint'), d, url0 || kitBase());
  if (typeof pdfLiga === 'function') pdfLiga($('#ktPdf'), () => $('#ktPrint'), () => document.title);
  const pega = async (b) => { b.disabled = true; try { const url = await Kit.link(chave); const e = $('#ktEstado'); if (e) e.textContent = kitEstadoTxt(chave); const q = document.querySelector('#ktPrint [data-kt-qr]'); if (q) q.innerHTML = ''; kitLiga(document.getElementById('ktPrint'), d, url); return url; } finally { b.disabled = false; } };
  $('#ktCopia').onclick = async (e) => { try { const url = await pega(e.target); try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch (x) { prompt('Copie o link:', url); } } catch (x) { toast(x.message); } };
  $('#ktZap').onclick = async (e) => { try { const url = await pega(e.target); const msg = await Kit.mensagem(chave, url);
    window.open(fone.length >= 8 ? waLink(msg, fone) : 'https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener'); } catch (x) { toast(x.message); } };
  $('#ktDicasOk').onclick = () => { DB.settings.kitDicas = $('#ktDicasTx').value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 14); save(); Kit.agendar(chave); toast('Dicas salvas'); admKit(chave); };
  $('#ktDicasPadrao').onclick = () => { delete DB.settings.kitDicas; save(); Kit.agendar(chave); toast('Dicas padrão de volta'); admKit(chave); };
  /* abriu o kit: republica (se já tem o curto), para o link do cliente estar igual ao que ele vê */
  if (Kit.curto(chave)) kitPublica(chave, d);
}

/* ---------- o botão "Kit da viagem (voucher)": em cada reserva confirmada (Reservas) ---------- */
function ktInjeta() {
  try {
    const st = document.getElementById('stage'); if (!st) return;
    st.querySelectorAll('.tacts[id^="ta-"]').forEach(cx => {
      if (cx.querySelector('[data-kit]') || cx.querySelector('.howgot')) return;   /* escolhendo como recebeu: não mexe */
      const b = DB.bookings.find(x => 'ta-' + x.id === cx.id); if (!b || b.status !== 'confirmed') return;
      cx.insertAdjacentHTML('beforeend', `<button type="button" class="mini" data-kit="${esc(kitChaveDe(b))}">Kit da viagem (voucher)</button>`);
    });
    st.querySelectorAll('[data-kit]').forEach(bt => { if (bt._kt) return; bt._kt = true; bt.onclick = (e) => { e.stopPropagation(); Kit.abrir(bt.dataset.kit); }; });
  } catch (e) { console.warn('kit', e); }
}
let _ktT = null;
if (typeof MutationObserver === 'function' && typeof app !== 'undefined' && app) new MutationObserver(() => { clearTimeout(_ktT); _ktT = setTimeout(ktInjeta, 20); }).observe(app, { childList: true, subtree: true });

/* ---------- reserva mudou → o kit que o cliente já tem se atualiza ---------- */
/* toda mudança de reserva passa por cloudPushBooking/cloudUpdateBooking (painel, assistente, pagamento) */
for (const nome of ['cloudPushBooking', 'cloudUpdateBooking']) {
  if (typeof window[nome] !== 'function') continue;
  const orig = window[nome];
  window[nome] = function (b) { try { if (b) Kit.agendar(kitChaveDe(b)); } catch (e) {} return orig.apply(this, arguments); };
}
if (typeof Bookings !== 'undefined') for (const k of ['create', 'criarManual', 'cancel', 'confirmarCliente', 'payBalance']) {
  if (typeof Bookings[k] !== 'function') continue;
  const orig = Bookings[k];
  Bookings[k] = function (a) { const r = orig.apply(this, arguments);
    try { const b = (r && r.id && r) || DB.bookings.find(x => x.id === a || x.code === a) || null; if (b) Kit.agendar(kitChaveDe(b)); } catch (e) {} return r; };
}

/* "Avisar cliente": o e-mail de confirmação (função avisos, no servidor) leva o link do kit.
   O gatilho do banco dispara quando a reserva é marcada — então o kit é publicado ANTES (no máximo 5 s). */
if (typeof Bookings !== 'undefined' && typeof Bookings.confirmarCliente === 'function') {
  const _conf = Bookings.confirmarCliente.bind(Bookings);
  Bookings.confirmarCliente = function (id) {
    const b = Bookings.get(id); if (!b || b.clienteConfirmado) return null;
    if (!kitPodeNuvem()) return _conf(id);
    b.clienteConfirmado = { em: new Date().toISOString(), publicandoKit: true };   /* a tela já mostra "avisado" */
    Promise.race([Kit.link(kitChaveDe(b)), new Promise(r => setTimeout(r, 5000))]).catch(() => {})
      .finally(() => { delete b.clienteConfirmado; _conf(id); });
    return b;
  };
}

/* o servidor (e-mail de recibo e confirmação) só põe o link #/kt/ em app que sabe abrir o kit: avisa nos Ajustes (públicos).
   Também está em semeiaNovidades (store.js), que roda depois de cada leitura da nuvem e sobe se for o dono. */
if (typeof DB !== 'undefined' && DB && DB.settings && +DB.settings.kitVersao !== 1) { DB.settings.kitVersao = 1; try { localStorage.setItem(DB_KEY, JSON.stringify(DB)); } catch (e) {} }

/* ---------- ligar no app (aba escondida) ---------- */
const _viewAdmKit = viewAdm;
viewAdm = function (tab, arg) { if (tab === 'kit') return admKit(arg ? decodeURIComponent(arg) : ''); return _viewAdmKit(tab, arg); };

function kitCss() {
  if (document.getElementById('ktCss')) return;
  const s = document.createElement('style'); s.id = 'ktCss';
  /* a marca dele: azul bávaro #163E70 · amarelo #F2C230 · marfim #FBF8F3; títulos Montserrat, texto Karla */
  s.textContent = `
  .ktTela{padding:16px;background:var(--paper);min-height:100vh}
  .ktBarra{max-width:794px;margin:0 auto 10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}
  .ktBts{display:flex;gap:8px;flex-wrap:wrap}
  .ktEstado{max-width:794px;margin:0 auto 12px;font-size:13.5px;color:var(--ink-2)}
  .ktDicasEd{max-width:794px;margin:16px auto}.ktDicasEd textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink)}
  .ktDoc{--kt-c:#F7F2EA;--kt-t:#111111;--kt-t2:#3F4650;--kt-l:#E2DCD1;max-width:794px;margin:0 auto;background:var(--kt-c);color:var(--kt-t);border-radius:18px;overflow:hidden;box-shadow:0 18px 50px -30px rgba(0,0,0,.4);font:15px/1.5 var(--f-ui,Karla,system-ui,sans-serif);text-align:left}
  .ktDoc h1,.ktDoc h2,.ktDoc h3{font-family:var(--f-display,Montserrat,system-ui,sans-serif);font-weight:700;color:var(--kt-n);margin:0;letter-spacing:-.01em}
  .kt-topo{background:var(--kt-n);color:#FBF8F3;padding:28px 28px 24px;position:relative}
  .kt-topo h1{color:#fff;font-size:31px;line-height:1.12;margin:8px 0 6px;letter-spacing:-.02em}
  .kt-selo{float:right;display:block;width:66px;height:66px;border-radius:50%;border:3px solid var(--kt-a);margin-left:12px;object-fit:cover;background:#000}
  .kt-eyebrow{margin:0;font:700 11px/1.3 var(--f-ui,system-ui);letter-spacing:.16em;text-transform:uppercase;color:var(--kt-a)}
  .kt-svCorpo .kt-eyebrow{color:var(--kt-at)}
  .kt-cab{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .kt-cod{flex:none;text-align:center;padding:8px 14px;border:2px dashed var(--kt-n);border-radius:12px;background:var(--kt-c);line-height:1.1;margin-top:-10px}
  .kt-cod small{display:block;font:700 9.5px/1.2 var(--f-ui,system-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--kt-t2)}
  .kt-cod b{display:block;font:800 20px/1.2 var(--f-mono,ui-monospace);color:var(--kt-n);letter-spacing:.05em}
  .kt-per{margin:0;opacity:.9}
  .kt-acsTopo{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;clear:both}
  .kt-cta{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;background:var(--kt-cta);color:var(--kt-ctai);font-weight:700;text-decoration:none;border:0;cursor:pointer;font-size:14.5px}
  .kt-cta svg{width:18px;height:18px}
  .kt-bt{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid rgba(251,248,243,.45);background:transparent;color:#FBF8F3;font:600 14px/1 var(--f-ui,system-ui);cursor:pointer}
  .kt-lista{display:grid;margin:18px 22px 4px;border:1px solid var(--kt-l);border-radius:14px;overflow:hidden;background:#fff}
  .kt-lista a{display:grid;grid-template-columns:58px 1fr auto;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid var(--kt-l);color:var(--kt-t);text-decoration:none}
  .kt-lista a:first-child{border-top:0}
  .kt-ld{font:700 13px/1 var(--f-mono,ui-monospace);color:var(--kt-n)}
  .kt-lista span:last-child{color:var(--kt-t2);font-size:13px}
  .kt-sv{margin:18px 22px;background:#fff;border:1px solid var(--kt-l);border-radius:16px;overflow:hidden}
  .kt-svTopo{position:relative;min-height:12px}
  .kt-svTopo img{display:block;width:100%;height:170px;object-fit:cover}
  .kt-fcr{position:absolute;right:8px;bottom:6px;max-width:70%;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font-size:10px;line-height:1.35;text-align:right}
  .kt-dia{position:absolute;left:14px;bottom:-22px;width:60px;padding:6px 0;border-radius:12px;background:var(--kt-n);color:#fff;text-align:center;line-height:1.05;box-shadow:0 6px 16px -8px rgba(0,0,0,.5)}
  .kt-svTopo:not(:has(img)) .kt-dia{position:static;margin:14px 0 0 14px}
  .kt-dia b{display:block;font:700 22px/1 var(--f-display,system-ui);color:var(--kt-a)}
  .kt-dia small{display:block;font-size:10px;letter-spacing:.12em;text-transform:uppercase;opacity:.9}
  .kt-svCorpo{padding:30px 20px 18px}
  .kt-svCorpo h2{font-size:21px;line-height:1.25;margin:4px 0 2px}
  .kt-res{margin:0 0 6px;color:var(--kt-t2)}
  .kt-grade{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
  .kt-grade > div{background:var(--kt-c);border-radius:12px;padding:10px 12px}
  .kt-grade .kt-lg{grid-column:1/-1}
  .kt-grade small,.kt-pg small{display:block;font:700 10.5px/1.2 var(--f-ui,system-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--kt-t2)}
  .kt-grade b{display:block;color:var(--kt-n);margin-top:2px}
  .kt-grade span{display:block;color:var(--kt-t2);font-size:13.5px}
  .kt-lk{display:inline-flex;align-items:center;gap:6px;margin-top:6px;color:var(--kt-n);font-weight:700;font-size:14px;text-decoration:underline;text-underline-offset:3px}
  .kt-lk svg{width:16px;height:16px}
  .kt-sv h3,.kt-box h3{font-size:15px;margin:14px 0 6px}
  .kt-par{margin:0;padding-left:22px}.kt-par li{margin:5px 0}.kt-par li b{display:block;color:var(--kt-n)}.kt-par li span{color:var(--kt-t2);font-size:13.5px}
  .kt-duas{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .kt-ok,.kt-no,.kt-levar{margin:0;padding:0;list-style:none}
  .kt-ok li,.kt-no li,.kt-levar li{position:relative;padding:3px 0 3px 22px;font-size:14px}
  .kt-ok li::before{content:"✓";position:absolute;left:2px;color:#2E6B4F;font-weight:800}
  .kt-no li::before{content:"–";position:absolute;left:4px;color:#a3053f;font-weight:800}
  .kt-levar li::before{content:"";position:absolute;left:6px;top:11px;width:7px;height:7px;border-radius:50%;background:var(--kt-a)}
  .kt-pg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0 8px}
  .kt-pg > div{border-radius:12px;padding:10px 12px;background:#E3EDE6}
  .kt-pg > div.resta{background:#F7EDD8}
  .kt-pg b{display:block;font:700 19px/1.2 var(--f-display,system-ui);color:var(--kt-n)}
  .kt-pg span{display:block;font-size:12.5px;color:var(--kt-t2)}
  .kt-tot{margin:14px 22px 0}
  .kt-svCorpo > .kt-cta{margin:4px 0 2px}
  .kt-acs{margin-top:8px}
  .kt-fino{margin:10px 0 0;font-size:12.5px;color:var(--kt-t2)}
  .kt-box{margin:18px 22px;padding:16px 18px;background:#fff;border:1px solid var(--kt-l);border-radius:16px}
  .kt-box > .kt-lk{display:flex}
  .kt-ind{display:flex;gap:12px;align-items:center;padding:9px 0;border-top:1px solid var(--kt-l);color:var(--kt-t);text-decoration:none}
  .kt-ind:first-of-type{border-top:0}
  .kt-ind b{display:block;color:var(--kt-n)}.kt-ind small{display:block;color:var(--kt-t2);font-size:13px}
  .kt-indIc{flex:none;width:36px;height:36px;border-radius:10px;background:#F1E6E1;display:grid;place-items:center}
  .kt-indIc svg{width:20px;height:20px}
  .kt-parc{display:flex;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--kt-l)}
  .kt-parc:first-of-type{border-top:0}
  .kt-parc i{font-style:normal;min-width:54px;text-align:center;padding:6px 8px;border-radius:10px;background:var(--kt-n);color:var(--kt-a);font-weight:800}
  .kt-parc small{display:block;color:var(--kt-t2)}
  .kt-pe{display:flex;gap:16px;align-items:center;margin:18px 0 0;padding:18px 22px;background:var(--kt-n);color:#FBF8F3}
  .kt-pe b{display:block;color:#fff}.kt-pe span{display:block;font-size:13px;opacity:.9}
  .kt-qr{flex:none;width:110px;min-height:10px;background:#fff;border-radius:10px;padding:6px}
  .kt-qr:empty{display:none}
  .kt-qr svg{display:block;width:100%;height:auto}
  .kt-cont{margin-top:6px}
  @media(max-width:620px){.ktTela{padding:10px}.kt-topo{padding:22px 18px 18px}.kt-topo h1{font-size:25px}.kt-selo{width:52px;height:52px}
    .kt-sv,.kt-box{margin:14px 10px}.kt-lista,.kt-tot{margin-left:10px;margin-right:10px}.kt-grade,.kt-duas{grid-template-columns:1fr}.kt-svCorpo{padding:28px 14px 14px}.kt-pe{flex-direction:column;align-items:flex-start}.kt-cod b{font-size:17px}}
  @media print{.kt-tela{display:none!important}}`;
  document.head.appendChild(s);
}
