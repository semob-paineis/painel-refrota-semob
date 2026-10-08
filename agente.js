/* ============================================================================
   AGENTE DE DÚVIDAS — Painel de Monitoramento REFROTA (SEMOB)
   ----------------------------------------------------------------------------
   Um assistente de conversa que roda INTEIRO no navegador: não usa IA externa,
   não envia pergunta nem dado para lugar nenhum e funciona offline.

   Princípios
   1. Nenhum número é escrito à mão. Toda quantidade citada numa resposta é
      calculada na hora, a partir da base por contrato (window.BASE_AGENTE,
      gerada por gerar_agente.py a partir da aba BASEDEDADOS). Ao carregar, o
      agente confere a própria base contra os totais do painel (DADOS) e avisa
      no console se algo não fechar.
   2. Toda resposta diz o RECORTE usado (frente, situação, UF, ano...) e a
      DEFINIÇÃO aplicada ("contratada = ..."), para o número ser auditável.
   3. As regras do painel (o que é "selecionada", "contratada", a Meta 2026
      só do Refrota Privado...) ficam em CONCEITOS, texto separado da lógica.
   4. Quando não entende, diz que não entendeu e mostra o que sabe responder.
      Não inventa.

   Fluxo:  pergunta -> normalizar -> extrair entidades (UF, ano, frente...)
           -> decidir a intenção -> calcular -> montar resposta + ações.

   Teste automatizado: Agente.responder(texto) devolve
   { html, fatos, acoes, sugestoes } sem tocar na tela; "fatos" traz os números
   crus usados na resposta (ver auditoria_agente.py).
   ========================================================================== */
(function () {
  'use strict';

  var BASE = window.BASE_AGENTE;
  if (!BASE || !BASE.linhas) { console.warn('[Agente] base_agente.js não carregada — agente desativado.'); return; }

  /* ======================================================================
     0. BASE: linhas -> objetos
     ====================================================================== */
  var R = BASE.linhas.map(function (l) {
    var o = {};
    BASE.colunas.forEach(function (c, i) { o[c] = l[i]; });
    ['qtdContr', 'elContr', 'e6Contr', 'trContr', 'qtdEntregue', 'qtdSel', 'elSel', 'e6Sel', 'trSel',
     'valorContr', 'liberado', 'apoio', 'contrapartida'].forEach(function (k) { o[k] = Number(o[k]) || 0; });
    o.frente = /privado/i.test(o.tipo || '') ? 'Privado' : 'Público';
    o.ano = o.anoPortaria === null || o.anoPortaria === undefined || o.anoPortaria === '' ? null : Number(o.anoPortaria) || null;
    o.cidade = String(o.municipio || '').split(',')[0].trim();
    o.velSel = o.elSel + o.e6Sel + o.trSel;
    return o;
  });

  /* ======================================================================
     1. TEXTO
     ====================================================================== */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function tem(n, frase) { return (' ' + n + ' ').indexOf(' ' + frase + ' ') >= 0; }
  function temAlgum(n, frases) {
    for (var i = 0; i < frases.length; i++) if (tem(n, frases[i])) return frases[i];
    return null;
  }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function int(v) { return Math.round(v).toLocaleString('pt-BR'); }
  function dec(v, c) { return v.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); }
  function pct(v) { return dec(v * 100, 1) + '%'; }
  function moeda(v) {
    var a = Math.abs(v);
    if (a >= 1e9) return 'R$ ' + dec(v / 1e9, 2) + ' bi';
    if (a >= 1e6) return 'R$ ' + dec(v / 1e6, 1) + ' mi';
    if (a >= 1e3) return 'R$ ' + dec(v / 1e3, 1) + ' mil';
    return 'R$ ' + dec(v, 2);
  }
  function plural(n, um, varios) { return int(n) + ' ' + (n === 1 ? um : varios); }
  function lista(itens) {
    if (itens.length <= 1) return itens.join('');
    return itens.slice(0, -1).join(', ') + ' e ' + itens[itens.length - 1];
  }

  /* ======================================================================
     2. ENTIDADES
     ====================================================================== */
  var NOME_UF = [
    ['mato grosso do sul', 'MS'], ['rio grande do norte', 'RN'], ['rio grande do sul', 'RS'],
    ['espirito santo', 'ES'], ['distrito federal', 'DF'], ['santa catarina', 'SC'],
    ['minas gerais', 'MG'], ['mato grosso', 'MT'], ['rio de janeiro', 'RJ'], ['sao paulo', 'SP'],
    ['pernambuco', 'PE'], ['tocantins', 'TO'], ['maranhao', 'MA'], ['amazonas', 'AM'],
    ['alagoas', 'AL'], ['sergipe', 'SE'], ['rondonia', 'RO'], ['roraima', 'RR'],
    ['paraiba', 'PB'], ['parana', 'PR'], ['bahia', 'BA'], ['ceara', 'CE'], ['goias', 'GO'],
    ['piaui', 'PI'], ['amapa', 'AP'], ['acre', 'AC'], ['estado do para', 'PA'], ['para', 'PA']
  ];
  var NOME_COMPLETO = {
    AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MG: 'Minas Gerais',
    MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará', PB: 'Paraíba', PE: 'Pernambuco',
    PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RO: 'Rondônia',
    RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo',
    TO: 'Tocantins'
  };
  var SIGLAS = Object.keys(NOME_COMPLETO);
  // Siglas que também são palavras comuns: só valem em MAIÚSCULAS no texto original.
  var SIGLA_AMBIGUA = ['AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
                       'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO', 'AC', 'ES'];
  var REGIOES = [['centro oeste', 'Centro-Oeste'], ['nordeste', 'Nordeste'], ['sudeste', 'Sudeste'],
                 ['norte', 'Norte'], ['sul', 'Sul']];

  // Cidades e proponentes presentes na base (para reconhecer "Salvador", "Prefeitura de X"...)
  var CIDADES = {};   // norm(cidade) -> nome
  var PROPONENTES = {}; // norm(proponente sem sufixo) -> nome
  R.forEach(function (r) {
    if (r.cidade) CIDADES[norm(r.cidade)] = r.cidade;
    if (r.proponente) {
      var p = norm(r.proponente).replace(/\b(ltda|s a|sa|spe|eireli|epp|me)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (p.length >= 6) PROPONENTES[p] = r.proponente;
    }
  });
  var AGENTES = {};
  R.forEach(function (r) { if (r.agente) AGENTES[norm(r.agente)] = r.agente; });

  function consumir(n, frase) { return (' ' + n + ' ').split(' ' + frase + ' ').join('  ').replace(/\s+/g, ' ').trim(); }

  function extrairEntidades(original) {
    var n = norm(original), e = { ufs: [], regioes: [], anos: [], cidades: [], proponentes: [], agentes: [] };

    // Siglas em maiúsculas (SP, MG...) no texto original
    var mm = String(original).match(/\b[A-Z]{2}\b/g) || [];
    mm.forEach(function (s) { if (SIGLAS.indexOf(s) >= 0 && e.ufs.indexOf(s) < 0) e.ufs.push(s); });

    // Cidades primeiro (frases longas antes): "Rio Branco" não vira "Rio"; "São Paulo" cidade x UF
    var cidadesOrd = Object.keys(CIDADES).sort(function (a, b) { return b.length - a.length; });
    var resto = n;
    // nomes de UF por extenso — antes das cidades para "estado de São Paulo"
    var ehEstado = function (nome) { return tem(resto, 'estado de ' + nome) || tem(resto, 'estado do ' + nome) || tem(resto, 'estado da ' + nome) || tem(resto, 'governo de ' + nome) || tem(resto, 'governo do ' + nome); };
    NOME_UF.forEach(function (p) {
      if (ehEstado(p[0]) && e.ufs.indexOf(p[1]) < 0) { e.ufs.push(p[1]); resto = consumir(resto, 'estado de ' + p[0]); resto = consumir(resto, 'estado do ' + p[0]); resto = consumir(resto, 'estado da ' + p[0]); }
    });
    // proponentes (empresas)
    Object.keys(PROPONENTES).sort(function (a, b) { return b.length - a.length; }).forEach(function (p) {
      if (tem(resto, p)) { e.proponentes.push(PROPONENTES[p]); resto = consumir(resto, p); }
    });
    cidadesOrd.forEach(function (c) {
      if (c.length >= 4 && tem(resto, c)) {
        // "São Paulo" sozinho, sem "cidade/município/prefeitura", fica como UF se a UF não foi citada
        var nomeUF = NOME_UF.filter(function (x) { return x[0] === c; })[0];
        var explicita = tem(resto, 'cidade de ' + c) || tem(resto, 'municipio de ' + c) || tem(resto, 'prefeitura de ' + c) || tem(resto, 'cidade ' + c) || tem(resto, 'prefeitura ' + c);
        if (nomeUF && !explicita) return;       // deixa para o laço de UF
        e.cidades.push(CIDADES[c]); resto = consumir(resto, c);
      }
    });
    NOME_UF.forEach(function (p) {
      if (tem(resto, p[0]) && e.ufs.indexOf(p[1]) < 0) {
        if (p[0] === 'para' && !(tem(resto, 'no para') || tem(resto, 'do para') || tem(resto, 'pelo para') || tem(resto, 'ao para'))) return;            // "para" é preposição; só vale "estado do Pará"/sigla PA
        e.ufs.push(p[1]); resto = consumir(resto, p[0]);
      }
    });
    REGIOES.forEach(function (p) {
      if (tem(resto, p[0])) {
        // "norte"/"sul" soltos só valem como região perto de "região/regiao/do/no/na"
        var solto = (p[0] === 'norte' || p[0] === 'sul');
        if (solto && !(tem(resto, 'regiao ' + p[0]) || tem(resto, 'regiao do ' + p[0]) || tem(resto, 'no ' + p[0]) || tem(resto, 'do ' + p[0]) || tem(resto, 'na ' + p[0]) || tem(resto, 'o ' + p[0]) || tem(resto, 'regiao norte'))) return;
        if (e.regioes.indexOf(p[1]) < 0) e.regioes.push(p[1]);
        resto = consumir(resto, p[0]);
      }
    });
    (n.match(/\b20(2[2-9]|3\d)\b/g) || []).forEach(function (a) { if (e.anos.indexOf(+a) < 0) e.anos.push(+a); });

    Object.keys(AGENTES).forEach(function (a) { if (a.length >= 4 && tem(n, a)) e.agentes.push(AGENTES[a]); });
    if (tem(n, 'bndes') && !e.agentes.length) R.forEach(function (r) { if (/bndes/i.test(r.agente) && e.agentes.indexOf(r.agente) < 0) e.agentes.push(r.agente); });

    // Frente
    e.frente = null;
    var pub = temAlgum(n, ['refrota publico', 'frente publica', 'publico', 'publica', 'prefeituras', 'governos']);
    var priv = temAlgum(n, ['refrota privado', 'frente privada', 'privado', 'privada', 'empresas', 'empresarios', 'operadores']);
    if (priv && !pub) e.frente = 'Privado'; else if (pub && !priv) e.frente = 'Público';

    // Tipo de veículo
    e.veic = null;
    if (temAlgum(n, ['eletrico', 'eletricos', 'eletrica', 'eletricas', 'eletrificado', 'eletrificados', 'zero emissao'])) e.veic = 'el';
    if (temAlgum(n, ['euro 6', 'euro vi', 'euro6', 'eurovi', 'euro'])) e.veic = e.veic ? 'ambos' : 'e6';
    if (temAlgum(n, ['trilhos', 'trilho', 'vlt', 'metro', 'trem'])) e.veic = e.veic ? e.veic : 'tr';

    // Situação (categoria)
    e.cat = null;
    if (temAlgum(n, ['em preparacao', 'a contratar', 'em preparacao a contratar', 'preparatoria', 'acao preparatoria'])) e.cat = 'preparacao';
    else if (temAlgum(n, ['a cancelar', 'desistencia', 'desistencias', 'desistiram'])) e.cat = 'acancelar';
    else if (temAlgum(n, ['cancelada', 'canceladas', 'cancelado', 'cancelados', 'cancelamento', 'cancelamentos'])) e.cat = 'cancelada';
    else if (temAlgum(n, ['habilitada', 'habilitadas', 'habilitado', 'habilitados', 'habilitacao'])) e.cat = 'habilitada';
    else if (temAlgum(n, ['contratada', 'contratadas', 'contratado', 'contratados', 'contratacao', 'contratacoes', 'contratou', 'contrataram', 'contratar'])) e.cat = 'contratada';
    e.situacaoTexto = null;
    [['em andamento', 'Em andamento'], ['concluida', 'Concluído'], ['concluido', 'Concluído'], ['concluidas', 'Concluído'], ['concluidos', 'Concluído'], ['em licitacao', 'Em licitação']].forEach(function (p) {
      if (tem(n, p[0])) e.situacaoTexto = p[1];
    });
    e.assin = !!/\bassinad\w*|\bassinatura\w*|\bassinou\b|\bfirmad\w*/.test(n);
    e.meses = [];
    [['janeiro', 1], ['fevereiro', 2], ['marco', 3], ['abril', 4], ['maio', 5], ['junho', 6], ['julho', 7], ['agosto', 8], ['setembro', 9], ['outubro', 10], ['novembro', 11], ['dezembro', 12]].forEach(function (m) {
      if (tem(resto, m[0]) || tem(resto, m[0].slice(0, 3) + ' ' + '20')) { if (e.meses.indexOf(m[1]) < 0) e.meses.push(m[1]); }
    });
    e.selecionada = !!temAlgum(n, ['selecionada', 'selecionadas', 'selecionado', 'selecionados', 'selecao', 'carteira']);
    e.entregue = !!temAlgum(n, ['entregue', 'entregues', 'entrega', 'entregas', 'em operacao', 'rodando']);
    e.desembolso = !!temAlgum(n, ['desembolsado', 'desembolsados', 'desembolso', 'liberado', 'liberados', 'liberacao', 'pago', 'pagos']);
    return e;
  }

  /* ======================================================================
     3. CÁLCULO — tudo passa por aqui
     ====================================================================== */
  function nomeSituacaoCat(c) {
    return { contratada: 'contratadas', preparacao: 'em preparação (a contratar)', acancelar: 'a cancelar (desistências)',
             cancelada: 'canceladas', habilitada: 'habilitadas (fora da carteira selecionada)' }[c] || c;
  }

  /** Monta o recorte a partir das entidades. */
  function escopo(e) {
    var s = { assin: e.assin, meses: e.meses, frente: e.frente, ufs: e.ufs, regioes: e.regioes, anos: e.anos, cidades: e.cidades,
              proponentes: e.proponentes, agentes: e.agentes, veic: e.veic, cat: e.cat, situacaoTexto: e.situacaoTexto,
              selecionada: e.selecionada, entregue: e.entregue, desembolso: e.desembolso };
    // Sem situação explícita: contratadas (o que o painel mostra por padrão). "selecionadas" => carteira selecionada.
    if (!s.cat && !s.situacaoTexto) s.cat = s.selecionada ? 'selecionada' : 'contratada';
    if (s.cat === 'contratada' && s.selecionada) s.cat = 'selecionada';
    return s;
  }
  function filtra(s, ignorar) {
    ignorar = ignorar || {};
    return R.filter(function (r) {
      if (s.frente && r.frente !== s.frente) return false;
      if (!ignorar.uf && s.ufs.length && s.ufs.indexOf(r.uf) < 0) return false;
      if (!ignorar.regiao && s.regioes.length && s.regioes.indexOf(r.regiao) < 0) return false;
      if (s.assin) {
        var ma = /^(\d{4})-(\d{2})/.exec(r.assinatura || '');
        if (!ma) return false;
        if (s.anos.length && s.anos.indexOf(+ma[1]) < 0) return false;
        if (s.meses && s.meses.length && s.meses.indexOf(+ma[2]) < 0) return false;
      } else {
        if (!ignorar.ano && s.anos.length && s.anos.indexOf(r.ano) < 0) return false;
        if (s.meses && s.meses.length) return false;
      }
      if (!ignorar.cidade && s.cidades.length && s.cidades.indexOf(r.cidade) < 0) return false;
      if (!ignorar.proponente && s.proponentes.length && s.proponentes.indexOf(r.proponente) < 0) return false;
      if (!ignorar.agente && s.agentes.length && s.agentes.indexOf(r.agente) < 0) return false;
      if (s.situacaoTexto && norm(r.situacao) !== norm(s.situacaoTexto)) return false;
      if (s.cat === 'selecionada') { if (r.cat === 'habilitada') return false; }
      else if (s.cat && !s.situacaoTexto && r.cat !== s.cat) return false;
      if (s.situacaoTexto && r.cat !== 'contratada') return false;
      return true;
    });
  }
  /** Veículos de uma linha, conforme a situação do recorte (contratado x selecionado). */
  function usaContratado(s) { return s.cat === 'contratada' || !!s.situacaoTexto; }
  function veicLinha(r, s, tipo) {
    var c = usaContratado(s);
    var t = tipo || s.veic;
    if (!t || t === 'ambos') {
      if (t === 'ambos') return c ? r.elContr + r.e6Contr : r.elSel + r.e6Sel;
      return c ? r.qtdContr : r.velSel;
    }
    if (t === 'el') return c ? r.elContr : r.elSel;
    if (t === 'e6') return c ? r.e6Contr : r.e6Sel;
    if (t === 'tr') return c ? r.trContr : r.trSel;
    return 0;
  }
  function invLinha(r, s) { return usaContratado(s) ? r.valorContr : r.apoio; }
  function soma(linhas, f) { var t = 0; linhas.forEach(function (r) { t += f(r); }); return t; }

  /** Agrega um conjunto de linhas conforme o recorte (única fonte dos números). */
  function agrega(L, s) {
    var contr = soma(L, function (r) { return r.qtdContr; });
    return {
      linhas: L,
      propostas: L.length,
      veiculos: soma(L, function (r) { return veicLinha(r, s); }),
      el: soma(L, function (r) { return veicLinha(r, s, 'el'); }),
      e6: soma(L, function (r) { return veicLinha(r, s, 'e6'); }),
      tr: soma(L, function (r) { return veicLinha(r, s, 'tr'); }),
      investimento: soma(L, function (r) { return invLinha(r, s); }),
      apoio: soma(L, function (r) { return r.apoio; }),
      valorContr: soma(L, function (r) { return r.valorContr; }),
      contr: contr,
      liberado: soma(L, function (r) { return r.liberado; }),
      entregues: soma(L, function (r) { return r.qtdEntregue; })
    };
  }
  function totais(s, ignorar) { return agrega(filtra(s, ignorar), s); }

  /* Descrição do recorte em linguagem direta */
  function descreveRecorte(s, opcoes) {
    opcoes = opcoes || {};
    var p = [];
    var sit = s.situacaoTexto ? 'em situação "' + s.situacaoTexto + '"' :
      (s.cat === 'selecionada' ? 'carteira selecionada (todas as situações, exceto habilitadas)' : nomeSituacaoCat(s.cat));
    p.push(sit);
    p.push(s.frente ? 'Refrota ' + s.frente : 'Refrota Público + Privado');
    if (s.ufs.length) p.push('UF: ' + s.ufs.join(', '));
    if (s.regioes.length) p.push('região: ' + s.regioes.join(', '));
    if (s.cidades.length) p.push('município: ' + s.cidades.join(', '));
    if (s.proponentes.length) p.push('proponente: ' + s.proponentes.join(', '));
    if (s.agentes.length) p.push('agente: ' + s.agentes.join(', '));
    if (s.assin) p.push('assinados' + (s.meses && s.meses.length ? ' em ' + s.meses.map(function (m) { return ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m]; }).join(', ') : '') + (s.anos.length ? '/' + s.anos.join(', ') : ''));
    else if (s.anos.length) p.push('ano da portaria: ' + s.anos.join(', '));
    if (s.veic) p.push({ el: 'ônibus elétricos', e6: 'ônibus Euro 6', tr: 'veículos sobre trilhos', ambos: 'elétricos + Euro 6' }[s.veic]);
    return p.join(' · ');
  }
  function definicaoDoRecorte(s) {
    if (usaContratado(s)) return 'Contratada = situação Contratada, Em licitação, Em andamento ou Concluída. Veículos e valor vêm das colunas “contratado(a)” da base.';
    if (s.cat === 'selecionada') return 'Carteira selecionada = todas as propostas selecionadas (contratadas, em preparação, a cancelar e canceladas); habilitadas ficam de fora. Veículos = quantidade selecionada; valor = apoio previsto (Novo PAC).';
    return 'Veículos = quantidade selecionada; valor = apoio previsto (Novo PAC).';
  }

  /* ======================================================================
     4. DIMENSÕES, MÉTRICAS E RANKINGS
     ====================================================================== */
  var DIMENSOES = {
    uf:        { chave: function (r) { return r.uf; }, rotulo: 'UF', singular: 'estado', nome: function (k) { return (NOME_COMPLETO[k] ? NOME_COMPLETO[k] + ' (' + k + ')' : k); }, ignorar: 'uf' },
    regiao:    { chave: function (r) { return r.regiao; }, rotulo: 'Região', singular: 'região', nome: function (k) { return k; }, ignorar: 'regiao' },
    cidade:    { chave: function (r) { return r.cidade + ' (' + r.uf + ')'; }, rotulo: 'Município', singular: 'município', nome: function (k) { return k; }, ignorar: 'cidade' },
    proponente:{ chave: function (r) { return r.proponente; }, rotulo: 'Proponente', singular: 'proponente', nome: function (k) { return k; }, ignorar: 'proponente' },
    ano:       { chave: function (r) { return r.ano === null ? 'sem ano' : String(r.ano); }, rotulo: 'Ano da portaria', singular: 'ano', nome: function (k) { return k; }, ignorar: 'ano' },
    agente:    { chave: function (r) { return r.agente || 'não informado'; }, rotulo: 'Agente financeiro', singular: 'agente financeiro', nome: function (k) { return k; }, ignorar: 'agente' },
    frente:    { chave: function (r) { return 'Refrota ' + r.frente; }, rotulo: 'Frente', singular: 'frente', nome: function (k) { return k; } },
    situacao:  { chave: function (r) { return r.situacao || 'não informada'; }, rotulo: 'Situação', singular: 'situação', nome: function (k) { return k; } },
    contrato:  { chave: function (r) { return r.proposta + ' · ' + r.proponente + ' — ' + (r.empreend || '') + ' (' + r.uf + ')'; }, rotulo: 'Proposta', singular: 'proposta', nome: function (k) { return k.replace(/^[^·]*· /, ''); } },
    tipoProp:  { chave: function (r) { return r.tipoProp || 'não informado'; }, rotulo: 'Tipo de proponente', singular: 'tipo de proponente', nome: function (k) { return k; } },
    mes:       { chave: function (r) { var m = /^(\d{4})-(\d{2})/.exec(r.assinatura || ''); return m ? m[1] + '-' + m[2] : 'sem data de assinatura'; }, rotulo: 'Mês de assinatura', singular: 'mês de assinatura', nome: function (k) { var m = /^(\d{4})-(\d{2})$/.exec(k); return m ? m[2] + '/' + m[1] : k; } },
    fonte:     { chave: function (r) { return r.fonte || 'não informada'; }, rotulo: 'Fonte', singular: 'fonte de recursos', nome: function (k) { return k; } }
  };

  var METRICAS = {
    veiculos:    { rotulo: 'veículos', f: function (t) { return t.veiculos; }, fmt: int },
    el:          { rotulo: 'ônibus elétricos', f: function (t) { return t.el; }, fmt: int },
    e6:          { rotulo: 'ônibus Euro 6', f: function (t) { return t.e6; }, fmt: int },
    tr:          { rotulo: 'veículos sobre trilhos', f: function (t) { return t.tr; }, fmt: int },
    investimento:{ rotulo: 'investimento', f: function (t) { return t.investimento; }, fmt: moeda },
    propostas:   { rotulo: 'propostas', f: function (t) { return t.propostas; }, fmt: int },
    entregues:   { rotulo: 'veículos entregues', f: function (t) { return t.entregues; }, fmt: int },
    liberado:    { rotulo: 'valor desembolsado', f: function (t) { return t.liberado; }, fmt: moeda },
    taxaEntrega: { rotulo: 'taxa de entrega (veículos entregues ÷ contratados)', f: function (t) { return t.contr ? t.entregues / t.contr : 0; }, fmt: pct, ratio: true, den: function (t) { return t.contr; }, contratada: true },
    taxaDesembolso: { rotulo: 'taxa de desembolso (valor liberado ÷ valor contratado)', f: function (t) { return t.valorContr ? t.liberado / t.valorContr : 0; }, fmt: pct, ratio: true, den: function (t) { return t.valorContr; }, contratada: true },
    medio:       { rotulo: 'valor contratado médio por veículo', f: function (t) { return t.contr ? t.valorContr / t.contr : 0; }, fmt: moeda, ratio: true, den: function (t) { return t.contr; }, contratada: true }
  };

  function dimensaoDaPergunta(n) {
    if (temAlgum(n, ['estado', 'estados', 'uf', 'ufs', 'unidade da federacao', 'unidades da federacao'])) return 'uf';
    if (temAlgum(n, ['regiao', 'regioes'])) return 'regiao';
    if (temAlgum(n, ['municipio', 'municipios', 'cidade', 'cidades', 'prefeitura', 'prefeituras'])) return 'cidade';
    if (temAlgum(n, ['proponente', 'proponentes', 'empresa', 'empresas', 'operador', 'operadores', 'quem'])) return 'proponente';
    if (/\bpor mes\b|\bmes (com|de)\b|\bmeses\b|\bem que mes\b/.test(n)) return 'mes';
    if (temAlgum(n, ['proposta', 'propostas', 'contrato', 'contratos', 'empreendimento', 'empreendimentos']) && /\b(maior|maiores|menor|menores|mais|menos)\b/.test(n) && /\b(qual|quais)\s+(a|as|o|os)?\s*(proposta|propostas|contrato|contratos|empreendimento|empreendimentos)\b|\b(maior|maiores|menor|menores)\s+(proposta|propostas|contrato|contratos|empreendimento|empreendimentos)\b/.test(n)) return 'contrato';
    if (temAlgum(n, ['tipo de proponente', 'tipos de proponente', 'prefeituras ou empresas', 'publico ou privado'])) return 'tipoProp';
    if (temAlgum(n, ['ano', 'anos', 'por ano', 'portaria'])) return 'ano';
    if (temAlgum(n, ['agente financeiro', 'agentes financeiros', 'agente', 'agentes', 'banco', 'bancos'])) return 'agente';
    if (temAlgum(n, ['frente', 'frentes', 'publico ou privado'])) return 'frente';
    if (temAlgum(n, ['fonte', 'fontes', 'fonte de recursos'])) return 'fonte';
    if (temAlgum(n, ['situacao', 'situacoes', 'status'])) return 'situacao';
    return null;
  }
  function metricaDaPergunta(n, e) {
    if (/\b(taxa|percentual|indice|ritmo) de entrega|\bmais atrasad|\batraso/.test(n)) return 'taxaEntrega';
    if (/\b(taxa|percentual|indice) de (desembolso|liberacao)/.test(n)) return 'taxaDesembolso';
    if (/\b(custo|preco|valor|ticket) medio|\bpor (veiculo|onibus)\b|\bmais caro|\bmais barato/.test(n)) return 'medio';
    if (e.entregue) return 'entregues';
    if (e.desembolso) return 'liberado';
    if (e.veic === 'el') return 'el';
    if (e.veic === 'e6') return 'e6';
    if (e.veic === 'tr') return 'tr';
    if (/\b(invest\w*|valor\w*|recurso\w*|reais|dinheiro|bilho\w*|milho\w*|apoio|gast\w*|financ\w*|custo\w*|orcamento)\b/.test(n)) return 'investimento';
    if (/\b(propostas?|contratos?|projetos?|empreendimentos?)\b/.test(n) && !/\b(veiculos?|onibus|frota)\b/.test(n)) return 'propostas';
    return 'veiculos';
  }

  function ranking(s, dim, metrica, asc) {
    var D = DIMENSOES[dim], M = METRICAS[metrica];
    var grupos = {};
    filtra(s, D.ignorar ? (function (o) { o[D.ignorar] = true; return o; })({}) : {}).forEach(function (r) {
      var k = D.chave(r);
      (grupos[k] = grupos[k] || []).push(r);
    });
    var linhas = Object.keys(grupos).map(function (k) {
      var L = grupos[k];
      var t = agrega(L, s);
      return { chave: k, nome: D.nome(k), valor: M.f(t), t: t };
    });
    var zeros = [];
    if (!M.ratio && (dim === 'uf' || dim === 'regiao')) {
      var comValor = {}; linhas.forEach(function (x) { if (x.valor > 0) comValor[x.chave] = 1; });
      var universo = dim === 'uf' ? SIGLAS : ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];
      var filtroGeo = dim === 'uf' ? s.ufs : s.regioes;
      zeros = universo.filter(function (k) { return !comValor[k] && (!filtroGeo.length || filtroGeo.indexOf(k) >= 0); });
    }
    var total;
    if (M.ratio) {
      linhas = linhas.filter(function (x) { return M.den(x.t) > 0; });
      var ig = {}; if (D.ignorar) ig[D.ignorar] = true;
      total = M.f(agrega(filtra(s, ig), s));
    } else {
      total = soma(linhas, function (x) { return x.valor; });
      if (dim !== 'situacao' && dim !== 'frente') linhas = linhas.filter(function (x) { return x.valor > 0; });
    }
    linhas.sort(function (a, b) {
      return (asc ? a.valor - b.valor : b.valor - a.valor) ||
        (M.ratio ? M.den(b.t) - M.den(a.t) : (b.t.veiculos - a.t.veiculos)) || (a.nome < b.nome ? -1 : 1);
    });
    return { linhas: linhas, total: total, dim: dim, metrica: metrica, zeros: zeros };
  }

  /* ======================================================================
     5. CONCEITOS (regras do painel em linguagem direta)
     ====================================================================== */
  var CONCEITOS = [
    { chaves: ['o que e refrota', 'refrota', 'programa refrota', 'o que e o programa'],
      titulo: 'O que é o Refrota',
      texto: 'O Refrota é o programa de renovação de frota do transporte público coletivo, com apoio do Novo PAC (OGU), da Secretaria Nacional de Mobilidade (SEMOB). Tem duas frentes: <b>Refrota Público</b> (prefeituras e governos de estado) e <b>Refrota Privado</b> (empresas operadoras). Financia ônibus elétricos, ônibus Euro 6 (Euro VI) e veículos sobre trilhos.' },
    { chaves: ['selecionada', 'selecionadas', 'proposta selecionada', 'o que e selecionado', 'carteira selecionada'],
      titulo: 'Proposta selecionada',
      texto: 'É a proposta aprovada para entrar na carteira do programa. A carteira selecionada reúne as propostas hoje <b>contratadas, em preparação, a cancelar (desistências) e canceladas</b>; as <b>habilitadas</b> ainda não são selecionadas e ficam de fora. O valor da carteira selecionada é o apoio previsto (Novo PAC).' },
    { chaves: ['contratada', 'contratadas', 'proposta contratada', 'o que e contratado', 'contratacao'],
      titulo: 'Proposta contratada',
      texto: 'Conta como contratada a proposta com situação <b>Contratada, Em licitação, Em andamento ou Concluída</b>. Veículos e valor contratados vêm das colunas de contratação da base. O “investimento contratado” é o valor contratado (não o apoio previsto).' },
    { chaves: ['em preparacao', 'a contratar', 'acao preparatoria', 'carteira em preparacao', 'preparatoria'],
      titulo: 'Em preparação (a contratar)',
      texto: 'São as propostas selecionadas em <b>ação preparatória</b>, ainda sem contrato. É o estoque que pode virar contratação nas próximas atualizações.' },
    { chaves: ['a cancelar', 'desistencia', 'desistencias', 'desistiu'],
      titulo: 'A cancelar (desistências)',
      texto: 'Propostas selecionadas cuja situação é <b>Desistência</b>: o proponente desistiu e o cancelamento ainda vai ser formalizado. <b>Desistência da habilitação</b> é outra coisa: não conta como selecionada nem contratada.' },
    { chaves: ['cancelada', 'canceladas', 'cancelados', 'cancelamento'],
      titulo: 'Canceladas',
      texto: 'Propostas selecionadas com situação <b>Cancelada</b>. Entram na carteira selecionada (histórico), mas não na carteira ativa.' },
    { chaves: ['habilitada', 'habilitadas', 'habilitacao'],
      titulo: 'Habilitadas',
      texto: 'Propostas <b>habilitadas</b> ainda não foram selecionadas; por isso não entram nos totais de propostas selecionadas nem de contratadas.' },
    { chaves: ['meta 2026', 'meta', 'meta de 5000', '5000 veiculos'],
      titulo: 'Meta 2026',
      texto: 'A meta é de <b>5.000 unidades de veículos selecionados para o Refrota Privado</b> em 2026. Por regra do painel, o “realizado” conta apenas veículos selecionados do <b>Refrota Privado</b> com portaria de 2026 — mesmo quando o painel está em “Consolidado”.' },
    { chaves: ['euro 6', 'euro vi', 'o que e euro'],
      titulo: 'Euro 6 (Euro VI)',
      texto: 'Ônibus a diesel/combustão com a fase de emissões P8 / Euro VI, a norma mais restritiva em vigor. No painel aparece como “Euro VI”.' },
    { chaves: ['eletrico', 'eletricos', 'onibus eletrico'],
      titulo: 'Ônibus elétricos',
      texto: 'Ônibus 100% elétricos (zero emissão local). O painel mostra a participação deles na frota contratada, que é calculada sobre o total de veículos contratados.' },
    { chaves: ['trilhos', 'veiculos sobre trilhos', 'vlt'],
      titulo: 'Veículos sobre trilhos',
      texto: 'Veículos de transporte sobre trilhos financiados pelo programa (ex.: VLT). São uma parcela pequena do total de veículos.' },
    { chaves: ['apoio', 'previsto novo pac', 'valor de apoio', 'diferenca entre apoio e valor contratado'],
      titulo: 'Apoio previsto x valor contratado',
      texto: '<b>Apoio (previsto Novo PAC)</b> é o valor de recursos federais reservado à proposta; <b>valor contratado</b> é o valor efetivamente contratado. Por isso o investimento da carteira selecionada (apoio) é diferente do investimento contratado.' },
    { chaves: ['entregue', 'entregues', 'veiculos entregues'],
      titulo: 'Veículos entregues',
      texto: 'São os veículos já entregues aos proponentes (“Qtd. entregue” da base). Atenção: o painel aplica ajustes manuais na região Norte na divisão entre elétricos e Euro 6; por isso o <b>total</b> de entregues bate, mas a divisão por tipo pode divergir levemente da soma bruta da base.' },
    { chaves: ['desembolsado', 'desembolso', 'liberado', 'valor liberado'],
      titulo: 'Valor desembolsado',
      texto: 'É o valor já liberado/desembolsado dos contratos (“Valor liberado/desembolsado” da base).' },
    { chaves: ['ano da portaria', 'portaria', 'ano portaria'],
      titulo: 'Ano da portaria',
      texto: 'Ano da portaria que selecionou a proposta. É o critério usado nas visões “por ano” e na Meta 2026.' },
    { chaves: ['referencia', '31 07', 'data de referencia', 'evolucao', 'baseline'],
      titulo: 'Data de referência (31/07/2026)',
      texto: 'Os cards “Evolução desde a Data de Referência” e “Destaques do Período” comparam sempre com a mesma data de referência: <b>31/07/2026</b>.' },
    { chaves: ['propostas ou projetos', 'projetos', 'termo proposta'],
      titulo: 'Propostas x projetos',
      texto: 'No painel, o termo usado é <b>propostas</b>. Cada linha da base é uma proposta/contrato.' },
    { chaves: ['fonte dos dados', 'de onde vem', 'atualizacao', 'atualizado', 'quando foi atualizado'],
      titulo: 'Fonte e atualização',
      texto: 'Os dados vêm da planilha “Dados_Refrota_Contratações” (aba BASEDEDADOS), atualizada semanalmente pela SEMOB. Este agente usa exatamente a mesma base do painel.' }
  ];

  function melhorConceito(n) {
    var melhor = null, pontos = 0;
    CONCEITOS.forEach(function (c) {
      c.chaves.forEach(function (k) {
        if (tem(n, norm(k))) { var p = norm(k).split(' ').length * 10 + norm(k).length; if (p > pontos) { pontos = p; melhor = c; } }
      });
    });
    return melhor;
  }

  /* ======================================================================
     6. RESPOSTAS
     ====================================================================== */
  var SUGESTOES_BASE = [
    'Qual estado contratou mais ônibus elétricos?',
    'Quais as 5 cidades com mais veículos contratados?',
    'Quanto foi investido no Nordeste?',
    'Qual a participação de São Paulo nos elétricos?',
    'O que mudou desde 31/07?',
    'Como está a Meta 2026?'
  ];

  function tabelaRanking(rk, limite, mostrarParticipacao) {
    var M = METRICAS[rk.metrica];
    var top = rk.linhas.slice(0, limite);
    mostrarParticipacao = mostrarParticipacao && !M.ratio;
    var h = '<table class="agente__tab"><thead><tr><th>#</th><th>' + esc(DIMENSOES[rk.dim].rotulo) + '</th><th class="n">' + esc(M.rotulo.charAt(0).toUpperCase() + M.rotulo.slice(1)) + '</th>' +
      (mostrarParticipacao ? '<th class="n">Part.</th>' : '') + '</tr></thead><tbody>';
    top.forEach(function (x, i) {
      h += '<tr><td>' + (i + 1) + '</td><td>' + esc(x.nome) + '</td><td class="n">' + M.fmt(x.valor) + '</td>' +
        (mostrarParticipacao ? '<td class="n">' + (rk.total ? pct(x.valor / rk.total) : '—') + '</td>' : '') + '</tr>';
    });
    return h + '</tbody></table>';
  }

  function rodape(s, extra) {
    var notaAno = (s.anos.length && !s.assin) ? '<br>“Ano” = ano da portaria de seleção (para a data de assinatura, pergunte “assinados em 2025”).' : '';
    return '<div class="agente__fonte"><b>Recorte:</b> ' + esc(descreveRecorte(s)) + '.<br>' + esc(definicaoDoRecorte(s)) + notaAno +
      (extra ? '<br>' + extra : '') + '</div>';
  }

  function acoesRadar(s) {
    var q = [];
    if (s.ufs.length) q.push('uf=' + encodeURIComponent(s.ufs.join(',')));
    if (s.frente) q.push('tipo=' + encodeURIComponent(s.frente === 'Privado' ? 'Refrota Privado' : 'Refrota'));
    var sit = s.situacaoTexto ? s.situacaoTexto : ({ contratada: 'Contratada,Em andamento,Concluído,Em licitação', preparacao: 'Em ação preparatória', acancelar: 'Desistência', cancelada: 'Cancelada', habilitada: 'Habilitada' }[s.cat] || null);
    if (sit) q.push('situacao=' + encodeURIComponent(sit));
    if (s.cidades.length === 1) q.push('busca=' + encodeURIComponent(s.cidades[0]));
    else if (s.proponentes.length === 1) q.push('busca=' + encodeURIComponent(s.proponentes[0]));
    return [{ rotulo: 'Ver no Radar de Propostas', href: 'propostas.html' + (q.length ? '?' + q.join('&') : '') }];
  }

  function respostaRanking(e, n, dim, metrica, asc) {
    var s = escopo(e);
    if (METRICAS[metrica].contratada && !s.situacaoTexto) s.cat = 'contratada';
    var rk = ranking(s, dim, metrica, asc);
    var D = DIMENSOES[dim], M = METRICAS[metrica];
    var pediuN = (n.match(/\b(\d{1,2})\s+(?:primeiros|maiores|menores|principais|estados|ufs|cidades|municipios|regioes|proponentes|empresas|anos|agentes)/) || n.match(/\btop\s*(\d{1,2})\b/) || [])[1];
    var limite = Math.min(pediuN ? +pediuN : (dim === 'regiao' || dim === 'frente' || dim === 'ano' || dim === 'agente' || dim === 'situacao' || dim === 'fonte' ? 10 : 5), 15);
    if (!rk.linhas.length || rk.total === 0 && !asc) {
      return { html: '<p>Não há ' + esc(M.rotulo) + ' neste recorte.</p>' + rodape(s), fatos: { vazio: true }, acoes: [], sugestoes: SUGESTOES_BASE };
    }
    var topo = rk.linhas[0];
    var empatados = rk.linhas.filter(function (x) { return x.valor === topo.valor; });
    var qual = asc ? 'menor' : 'maior';
    var nomeDim = D.singular;
    var head;
    if (asc && rk.zeros && rk.zeros.length) {
      head = 'Em ' + esc(M.rotulo) + ', ' + (rk.zeros.length === 1 ? '<b>' + esc(DIMENSOES[dim].nome(rk.zeros[0])) + '</b> não tem nenhum' : '<b>' + int(rk.zeros.length) + ' ' + (dim === 'uf' ? 'estados' : 'regiões') + '</b> não têm nenhum (' + esc(lista(rk.zeros.map(function (k) { return dim === 'uf' ? k : k; }))) + ')') +
        '. Entre os que têm, o menor valor é de <b>' + esc(topo.nome) + '</b>: <b>' + M.fmt(topo.valor) + '</b>.';
    } else if (empatados.length > 4) {
      head = '<b>' + int(empatados.length) + ' ' + esc(nomeDim === 'estado' ? 'estados' : nomeDim + 's') + '</b> empatam no topo, todos com <b>' + M.fmt(topo.valor) + '</b> em ' + esc(M.rotulo.split(' (')[0]) + '. Desempatando pelo maior volume contratado, o primeiro é <b>' + esc(topo.nome) + '</b>.';
    } else if (empatados.length > 1 && empatados.length <= 4) {
      head = 'Há <b>empate</b> no topo (por ' + esc(nomeDim) + '): ' + lista(empatados.map(function (x) { return '<b>' + esc(x.nome) + '</b>'; })) + ', cada um com <b>' + M.fmt(topo.valor) + '</b> em ' + esc(M.rotulo) + '.';
    } else if (M.ratio) {
      head = 'Por ' + esc(nomeDim) + ', a ' + (asc ? 'menor' : 'maior') + ' ' + esc(M.rotulo.split(' (')[0]) + ' é a de <b>' + esc(topo.nome) + '</b>: <b>' + M.fmt(topo.valor) + '</b> (média do programa no recorte: ' + M.fmt(rk.total) + ').';
    } else {
      head = 'Por ' + esc(nomeDim) + ', ' + (asc ? 'o menor volume' : 'o maior volume') + ' de ' + esc(M.rotulo) + ' está em <b>' + esc(topo.nome) + '</b>: <b>' + M.fmt(topo.valor) + '</b>' +
        (rk.total ? ' — ' + pct(topo.valor / rk.total) + ' do total de ' + M.fmt(rk.total) + '.' : '.');
    }
    var html = '<p>' + head + '</p>' + (rk.linhas.length > 1 ? tabelaRanking(rk, limite, true) : '') +
      (rk.linhas.length > limite ? '<p class="agente__mini">Mostrando ' + limite + ' de ' + rk.linhas.length + (M.ratio ? '.' : ' com valor acima de zero.') + '</p>' : '') +
      rodape(s, asc ? 'Na tabela, quem tem valor zero fica de fora.' : '');
    return { html: html, fatos: { topo: topo.chave, valorTopo: topo.valor, total: rk.total, itens: rk.linhas.map(function (x) { return [x.chave, x.valor]; }), dim: dim, metrica: metrica },
             acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
  }

  function semRecorteGeografico(s) {
    return { assin: s.assin, meses: s.meses, frente: s.frente, ufs: [], regioes: [], anos: s.assin ? s.anos : [], cidades: [], proponentes: [], agentes: [], veic: s.veic,
             cat: s.cat, situacaoTexto: s.situacaoTexto, selecionada: s.selecionada, entregue: s.entregue, desembolso: s.desembolso };
  }
  function nomeDoRecorteGeo(s) {
    var p = [];
    s.ufs.forEach(function (u) { p.push(NOME_COMPLETO[u] || u); });
    s.regioes.forEach(function (r) { p.push('região ' + r); });
    s.cidades.forEach(function (c) { p.push(c); });
    s.proponentes.forEach(function (c) { p.push(c); });
    s.agentes.forEach(function (c) { p.push(c); });
    return p.length ? lista(p) : null;
  }

  function respostaValor(e, n, metrica, participacao) {
    var s = escopo(e), M = METRICAS[metrica];
    if (M.contratada && !s.situacaoTexto) s.cat = 'contratada';
    var t = totais(s);
    var v = M.f(t);
    // propostas "com" o tipo de veículo pedido (evita contar propostas só de outro tipo)
    var nProp = s.veic ? t.linhas.filter(function (r) { return veicLinha(r, s) > 0; }).length : t.propostas;
    var html, partes;
    if (!t.propostas) {
      html = '<p>Não encontrei propostas neste recorte.</p>' + rodape(s);
    } else {
      var geo = nomeDoRecorteGeo(s), ctxTxt = '', base = null, vb = null, mini = '';
      var rotEnt = geo || (s.agentes.length ? 'Agente financeiro ' + s.agentes.join(', ') : '') || (s.frente ? 'Refrota ' + s.frente : '') || (s.proponentes.length ? s.proponentes.join(', ') : '') || (s.cidades.length ? s.cidades.join(', ') : '');
      if (participacao && !M.ratio && rotEnt && (!geo || s.agentes.length || s.frente)) {
        var sb = {}; Object.keys(s).forEach(function (k) { sb[k] = s[k]; });
        sb.frente = null; sb.ufs = []; sb.regioes = []; sb.cidades = []; sb.proponentes = []; sb.agentes = []; if (!s.assin) sb.anos = [];
        base = totais(sb); vb = M.f(base);
        if (!/veicul|onibus|eletric|euro|invest|valor|proposta|trilho/.test(n)) {
          var bI = base.investimento, bP = base.propostas;
          mini = '<p class="agente__mini">Em investimento: ' + (bI ? pct(t.investimento / bI) : '—') + ' (' + moeda(t.investimento) + ' de ' + moeda(bI) + ') · Em propostas: ' + (bP ? pct(t.propostas / bP) : '—') + ' (' + t.propostas + ' de ' + bP + ').</p>';
        }
      } else if (geo || s.anos.length && !s.assin) {
        base = totais(semRecorteGeografico(s)); vb = M.f(base);
        if (vb && !M.ratio) ctxTxt = ' Isso é <b>' + pct(v / vb) + '</b> do total do programa (' + M.fmt(vb) + ').';
        else if (vb && M.ratio) ctxTxt = ' Média do programa: ' + M.fmt(vb) + '.';
      }
      if (participacao && vb && !M.ratio) {
        html = '<p>' + (rotEnt ? '<b>' + esc(rotEnt.charAt(0).toUpperCase() + rotEnt.slice(1)) + '</b> representa' : 'Este recorte representa') + ' <b>' + pct(v / vb) + '</b> do total de ' + esc(M.rotulo) + ' do programa: <b>' + M.fmt(v) + '</b> de <b>' + M.fmt(vb) + '</b>, em <b>' + plural(nProp, 'proposta', 'propostas') + '</b>.</p>' + mini;
      } else if (M.ratio) {
        html = '<p>' + esc(M.rotulo.split(' (')[0].charAt(0).toUpperCase() + M.rotulo.split(' (')[0].slice(1)) + ': <b>' + M.fmt(v) + '</b>' + (geo ? ' (' + esc(geo) + ')' : '') + '.' + ctxTxt + '</p>';
        if (metrica === 'taxaEntrega') html += '<p class="agente__mini">' + int(t.entregues) + ' veículos entregues de ' + int(t.contr) + ' contratados.</p>';
        if (metrica === 'taxaDesembolso') html += '<p class="agente__mini">' + moeda(t.liberado) + ' liberados de ' + moeda(t.valorContr) + ' contratados.</p>';
        if (metrica === 'medio') html += '<p class="agente__mini">' + moeda(t.valorContr) + ' contratados para ' + int(t.contr) + ' veículos. Contratos com mais de um tipo de veículo entram no total.</p>';
      } else if (metrica === 'propostas') {
        html = '<p>São <b>' + plural(t.propostas, 'proposta', 'propostas') + '</b>' + (geo ? ' (' + esc(geo) + ')' : '') + ' neste recorte, somando <b>' + int(t.veiculos) + '</b> veículos e <b>' + moeda(t.investimento) + '</b>.' + ctxTxt + '</p>';
      } else {
        html = '<p>' + (metrica === 'investimento' ? 'O investimento é de ' : 'São ') + '<b>' + M.fmt(v) + '</b>' +
          (metrica === 'investimento' ? '' : ' ' + esc(M.rotulo)) + (geo ? ' — ' + esc(geo) : '') + ', em <b>' + plural(nProp, 'proposta', 'propostas') + '</b>.' + ctxTxt + '</p>';
        if (!s.veic && metrica === 'veiculos') {
          html += '<p class="agente__mini">Composição: ' + int(t.el) + ' elétricos · ' + int(t.e6) + ' Euro 6 · ' + int(t.tr) + ' sobre trilhos.</p>';
        }
        if (metrica !== 'investimento' && !s.veic && metrica !== 'propostas') {
          html += '<p class="agente__mini">' + (usaContratado(s) ? 'Valor contratado' : 'Apoio previsto') + ': ' + moeda(t.investimento) + '.</p>';
        }
      }
      html += rodape(s);
    }
    return { html: html, fatos: { valor: v, propostas: t.propostas, propostasComTipo: nProp, veiculos: t.veiculos, el: t.el, e6: t.e6, tr: t.tr, investimento: t.investimento, entregues: t.entregues, liberado: t.liberado, base: vb, metrica: metrica },
             acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
  }

  /** "Quantos estados/municípios/proponentes...?" — contagens distintas no recorte. */
  function respostaDistintos(e, n) {
    var s = escopo(e);
    var dim = /\bestados?\b|\bufs?\b/.test(n) ? 'uf' : /\bmunicipios?\b|\bcidades?\b/.test(n) ? 'cidade' : /\bproponentes?\b|\bempresas?\b/.test(n) ? 'proponente' : /\bregioes\b/.test(n) ? 'regiao' : null;
    if (!dim) return null;
    var D = DIMENSOES[dim];
    var ig = {}; if (D.ignorar) ig[D.ignorar] = true;
    var L = filtra(s, ig).filter(function (r) { return !s.veic || veicLinha(r, s) > 0; }), vistos = {};
    L.forEach(function (r) { vistos[D.chave(r)] = 1; });
    var k = Object.keys(vistos).length;
    var plur = { uf: 'estados (UFs)', cidade: 'municípios', proponente: 'proponentes', regiao: 'regiões' }[dim];
    var html = '<p>São <b>' + int(k) + '</b> ' + plur + ' com propostas neste recorte (' + plural(L.length, 'proposta', 'propostas') + ').</p>';
    if (dim === 'uf' && k <= 27) {
      var ufsComPropostas = Object.keys(vistos);
      var faltam = SIGLAS.filter(function (u) { return ufsComPropostas.indexOf(u) < 0; });
      if (faltam.length && faltam.length <= 12) html += '<p class="agente__mini">Sem propostas neste recorte: ' + faltam.join(', ') + '.</p>';
    }
    return { html: html + rodape(s), fatos: { quantidade: k, dim: dim }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
  }

  /** Valor contratado médio por veículo, por tipo (usa só contratos de um único tipo de veículo). */
  function respostaCustoPorTipo(e) {
    var s = escopo(e); s.cat = 'contratada'; s.veic = null;
    var L = filtra(s);
    var el = L.filter(function (r) { return r.elContr > 0 && r.e6Contr === 0 && r.trContr === 0; });
    var e6 = L.filter(function (r) { return r.e6Contr > 0 && r.elContr === 0 && r.trContr === 0; });
    var cel = soma(el, function (r) { return r.elContr; }), ce6 = soma(e6, function (r) { return r.e6Contr; });
    var vel = soma(el, function (r) { return r.valorContr; }), ve6 = soma(e6, function (r) { return r.valorContr; });
    if (!cel || !ce6) return null;
    var mel = vel / cel, me6 = ve6 / ce6;
    var h = '<p>Valor contratado médio por veículo (apenas contratos de um único tipo de veículo):</p>' +
      '<table class="agente__tab"><thead><tr><th>Tipo</th><th class="n">Contratos</th><th class="n">Veículos</th><th class="n">Médio por veículo</th></tr></thead><tbody>' +
      '<tr><td>Elétrico</td><td class="n">' + int(el.length) + '</td><td class="n">' + int(cel) + '</td><td class="n">' + moeda(mel) + '</td></tr>' +
      '<tr><td>Euro 6</td><td class="n">' + int(e6.length) + '</td><td class="n">' + int(ce6) + '</td><td class="n">' + moeda(me6) + '</td></tr></tbody></table>' +
      '<p>Em média, o ônibus elétrico custa <b>' + dec(mel / me6, 2) + '×</b> o Euro 6 nos contratos considerados.</p>' +
      '<div class="agente__fonte"><b>Recorte:</b> ' + esc(descreveRecorte(s)) + '. Contratos que misturam elétricos e Euro 6 ficam de fora, pois a base não separa o valor por tipo.</div>';
    return { html: h, fatos: { medioEl: mel, medioE6: me6, contratosEl: el.length, contratosE6: e6.length }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function respostaLista(e, n) {
    var s = escopo(e), L = filtra(s).filter(function (r) { return !s.veic || veicLinha(r, s) > 0; });
    var limite = 10;
    L = L.slice().sort(function (a, b) { return (usaContratado(s) ? b.valorContr - a.valorContr : b.apoio - a.apoio); });
    if (!L.length) return { html: '<p>Não encontrei propostas neste recorte.</p>' + rodape(s), fatos: { n: 0 }, acoes: [], sugestoes: SUGESTOES_BASE };
    var h = '<p>Encontrei <b>' + plural(L.length, 'proposta', 'propostas') + '</b> neste recorte' + (L.length > limite ? ' (as ' + limite + ' de maior valor abaixo)' : '') + ':</p>' +
      '<table class="agente__tab"><thead><tr><th>Proponente</th><th>UF</th><th>Situação</th><th class="n">Veíc.</th><th class="n">Valor</th></tr></thead><tbody>';
    L.slice(0, limite).forEach(function (r) {
      h += '<tr><td>' + esc(r.proponente) + '</td><td>' + esc(r.uf) + '</td><td>' + esc(r.situacao) + '</td><td class="n">' + int(veicLinha(r, s)) + '</td><td class="n">' + moeda(invLinha(r, s)) + '</td></tr>';
    });
    h += '</tbody></table>' + rodape(s);
    return { html: h, fatos: { n: L.length, propostas: L.slice(0, limite).map(function (r) { return r.proposta; }) }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
  }

  function respostaFicha(e) {
    // Município ou proponente específico: ficha completa
    var s0 = escopo(e);
    var s = { frente: s0.frente, ufs: s0.ufs, regioes: s0.regioes, anos: s0.anos, cidades: s0.cidades, proponentes: s0.proponentes, agentes: s0.agentes,
              veic: s0.veic, cat: 'selecionada', situacaoTexto: null, selecionada: true, entregue: false, desembolso: false };
    var L = filtra(s);
    var nome = lista((s.cidades.concat(s.proponentes)).map(function (x) { return '<b>' + esc(x) + '</b>'; }));
    if (!L.length) return { html: '<p>Não encontrei propostas selecionadas de ' + nome + '.</p>', fatos: { n: 0 }, acoes: [], sugestoes: SUGESTOES_BASE };
    var contr = L.filter(function (r) { return r.cat === 'contratada'; });
    var por = {};
    L.forEach(function (r) { por[r.cat] = (por[r.cat] || 0) + 1; });
    var h = '<p>' + nome + ' tem <b>' + plural(L.length, 'proposta selecionada', 'propostas selecionadas') + '</b>: ' +
      lista(Object.keys(por).map(function (c) { return '<b>' + int(por[c]) + '</b> ' + nomeSituacaoCat(c); })) + '.</p>';
    h += '<p>Veículos contratados: <b>' + int(soma(contr, function (r) { return r.qtdContr; })) + '</b> (' + int(soma(contr, function (r) { return r.elContr; })) + ' elétricos · ' + int(soma(contr, function (r) { return r.e6Contr; })) + ' Euro 6 · ' + int(soma(contr, function (r) { return r.trContr; })) + ' sobre trilhos) — valor contratado <b>' + moeda(soma(contr, function (r) { return r.valorContr; })) + '</b>. ' +
      'Carteira selecionada: <b>' + int(soma(L, function (r) { return r.velSel; })) + '</b> veículos e <b>' + moeda(soma(L, function (r) { return r.apoio; })) + '</b> de apoio previsto.</p>';
    h += '<table class="agente__tab"><thead><tr><th>Proponente</th><th>Empreendimento</th><th>Situação</th><th class="n">Valor</th></tr></thead><tbody>';
    L.slice(0, 12).forEach(function (r) {
      h += '<tr><td>' + esc(r.proponente) + '</td><td>' + esc(r.empreend) + '</td><td>' + esc(r.situacao) + '</td><td class="n">' + moeda(r.cat === 'contratada' ? r.valorContr : r.apoio) + '</td></tr>';
    });
    h += '</tbody></table>' + (L.length > 12 ? '<p class="agente__mini">Mostrando 12 de ' + L.length + '.</p>' : '') +
      '<div class="agente__fonte"><b>Recorte:</b> carteira selecionada de ' + nome.replace(/<[^>]+>/g, '') + ' (exceto habilitadas).</div>';
    var acoes = acoesRadar(s);
    return { html: h, fatos: { n: L.length, contratadas: contr.length, veiculosContratados: soma(contr, function (r) { return r.qtdContr; }), valorContratado: soma(contr, function (r) { return r.valorContr; }) },
             acoes: acoes, sugestoes: SUGESTOES_BASE };
  }

  function respostaComparar(e, n, metrica) {
    // Dois ou mais valores da mesma dimensão (SP e MG; Norte e Sul; Público e Privado)
    var itens = null, dim = null;
    if (e.ufs.length > 1) { dim = 'uf'; }
    else if (e.regioes.length > 1) { dim = 'regiao'; }
    else if (e.cidades.length > 1) { dim = 'cidade'; }
    else if (e.anos.length > 1) { dim = 'ano'; }
    else if (/\bp[uú]blic/i.test(n) && /privad/i.test(n)) { dim = 'frente'; }
    if (!dim) return null;
    var s = escopo(e);
    if (dim === 'frente') s.frente = null;
    var rk = ranking(s, dim, metrica, false);
    var escolhidos = {
      uf: e.ufs, regiao: e.regioes, cidade: e.cidades, ano: e.anos.map(String), frente: ['Refrota Público', 'Refrota Privado']
    }[dim];
    rk.linhas = rk.linhas.filter(function (x) {
      return escolhidos.some(function (c) { return x.chave === c || x.chave.indexOf(c + ' (') === 0 || x.chave.split(' (')[0] === c; });
    });
    if (!rk.linhas.length) return null;
    var M = METRICAS[metrica];
    var h = '<p>Comparando em <b>' + esc(M.rotulo) + '</b>:</p>' + tabelaRanking(rk, 15, false) + rodape(s);
    return { html: h, fatos: { itens: rk.linhas.map(function (x) { return [x.chave, x.valor]; }), dim: dim, metrica: metrica }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
  }

  function respostaMeta() {
    var L = R.filter(function (r) { return r.frente === 'Privado' && r.cat !== 'habilitada' && r.ano === 2026; });
    var real = soma(L, function (r) { return r.qtdSel; });
    var meta = 5000;
    var faltam = Math.max(meta - real, 0);
    var h = '<p>A <b>Meta 2026</b> é de <b>' + int(meta) + '</b> unidades de veículos selecionados para o Refrota Privado. Já foram selecionados <b>' + int(real) + '</b> (' + pct(real / meta) + ' da meta) em <b>' + plural(L.length, 'proposta', 'propostas') + '</b>; ' +
      (faltam ? 'faltam <b>' + int(faltam) + '</b> veículos.' : 'a meta foi <b>superada</b>.') + '</p>' +
      '<div class="agente__fonte"><b>Regra do painel:</b> o realizado conta veículos selecionados do Refrota Privado com portaria em 2026, exceto habilitadas — mesmo na visão “Consolidado”.</div>';
    return { html: h, fatos: { realizado: real, meta: meta, propostas: L.length }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function respostaEvolucao() {
    var C = window.COMPARATIVO;
    if (!C && typeof COMPARATIVO !== 'undefined') C = COMPARATIVO;
    if (!C || !C.metricas) return null;
    var h = '<p>Comparação com a data de referência (<b>31/07/2026</b>):</p><table class="agente__tab"><thead><tr><th>Indicador</th><th class="n">31/07</th><th class="n">Atual</th><th class="n">Var.</th></tr></thead><tbody>';
    C.metricas.forEach(function (m) {
      var f = m.formato === 'moeda' ? moeda : int, d = m.atual - m.anterior;
      h += '<tr><td>' + esc(m.rotulo) + '</td><td class="n">' + f(m.anterior) + '</td><td class="n">' + f(m.atual) + '</td><td class="n">' + (d > 0 ? '+' : '') + f(d) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (C.destaques && C.destaques.length) h += '<ul class="agente__lista">' + C.destaques.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>';
    return { html: h, fatos: { metricas: C.metricas.map(function (m) { return [m.rotulo, m.anterior, m.atual]; }) }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function respostaResumo() {
    var sC = escopo(extrairEntidades('contratadas')), t = totais(sC);
    var sS = escopo(extrairEntidades('selecionadas')), ts = totais(sS);
    var rk = ranking(sC, 'uf', 'veiculos', false);
    var h = '<p>Panorama do Refrota (Público + Privado):</p><ul class="agente__lista">' +
      '<li><b>' + plural(t.propostas, 'proposta contratada', 'propostas contratadas') + '</b>, com <b>' + int(t.veiculos) + '</b> veículos (' + int(t.el) + ' elétricos · ' + int(t.e6) + ' Euro 6 · ' + int(t.tr) + ' sobre trilhos) e <b>' + moeda(t.investimento) + '</b> contratados.</li>' +
      '<li>Carteira selecionada: <b>' + int(ts.propostas) + '</b> propostas, <b>' + int(ts.veiculos) + '</b> veículos e <b>' + moeda(ts.investimento) + '</b> de apoio previsto.</li>' +
      '<li>Maior volume contratado: <b>' + esc(rk.linhas[0].nome) + '</b> (' + int(rk.linhas[0].valor) + ' veículos, ' + pct(rk.linhas[0].valor / rk.total) + ' do total).</li></ul>' + rodape(sC);
    return { html: h, fatos: { propostas: t.propostas, veiculos: t.veiculos, el: t.el, e6: t.e6, tr: t.tr, investimento: t.investimento }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function respostaConceito(c) {
    return { html: '<p><b>' + esc(c.titulo) + '</b></p><p>' + c.texto + '</p>', fatos: { conceito: c.titulo }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function respostaAjuda(prefixo) {
    var h = (prefixo ? '<p>' + prefixo + '</p>' : '') +
      '<p>Respondo com os números do próprio painel (mesma base, atualizada em ' + esc(dataBase()) + '). Posso, por exemplo:</p><ul class="agente__lista">' +
      '<li><b>Rankings:</b> “qual estado contratou mais ônibus elétricos?”, “5 cidades com maior investimento”, “proponentes com mais propostas”;</li>' +
      '<li><b>Totais:</b> “quantos ônibus Euro 6 em Minas Gerais?”, “quanto foi investido no Refrota Privado?”;</li>' +
      '<li><b>Comparações:</b> “compare SP e MG”, “Norte x Sul”;</li>' +
      '<li><b>Situação:</b> “propostas em preparação em MG”, “o que foi cancelado?”;</li>' +
      '<li><b>Cidade ou empresa:</b> “Salvador”, “Prefeitura de Belo Horizonte”;</li>' +
      '<li><b>Regras do painel:</b> “o que é proposta selecionada?”, “como está a Meta 2026?”, “o que mudou desde 31/07?”.</li></ul>';
    return { html: h, fatos: { ajuda: true }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  function dataBase() {
    var g = BASE.geradoEm; if (!g) return 'data não informada';
    var d = new Date(g); if (isNaN(d)) return 'data não informada';
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
  }

  /* ======================================================================
     7. DECISÃO
     ====================================================================== */
  function responder(texto) {
    var original = String(texto || '').trim();
    var n = norm(original);
    if (!n) return respostaAjuda('');
    if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|help|menu|o que voce faz|o que voce sabe|como funciona)\b/.test(n)) return respostaAjuda('');

    var e = extrairEntidades(original);
    var superlativoMax = temAlgum(n, ['mais', 'maior', 'maiores', 'principal', 'principais', 'lidera', 'lider', 'top', 'ranking', 'primeiro', 'primeiros', 'concentra', 'concentram']);
    var superlativoMin = temAlgum(n, ['menos', 'menor', 'menores', 'ultimo', 'ultimos', 'pior']);
    var dim = dimensaoDaPergunta(n);
    var metrica = metricaDaPergunta(n, e);

    // Meta
    if (temAlgum(n, ['meta 2026', 'meta de 2026', 'a meta', 'meta']) && !dim) return respostaMeta();
    // Evolução
    if (temAlgum(n, ['o que mudou', 'mudou', 'evolucao', 'desde 31 07', 'desde a data de referencia', 'novas contratacoes', 'crescimento', 'variacao', 'destaques'])) {
      var ev = respostaEvolucao(); if (ev) return ev;
    }
    // Panorama
    if (temAlgum(n, ['resumo', 'panorama', 'visao geral', 'situacao geral', 'balanco', 'em numeros', 'como esta o programa', 'como esta o refrota'])) return respostaResumo();

    // Conceito ("o que é X") — só quando a pergunta é de definição
    var defin = temAlgum(n, ['o que e', 'o que sao', 'o que significa', 'significado', 'defina', 'definicao', 'como e calculad', 'como funciona', 'qual a diferenca', 'quais as regras', 'regra', 'explique', 'conceito']);
    if (defin) { var c = melhorConceito(n); if (c) return respostaConceito(c); }

    // Contagens distintas: "quantos estados/municípios..."
    if (/\bquant[oa]s?\s+(estados?|ufs?|municipios?|cidades?|proponentes?|empresas?|regioes)\b/.test(n)) {
      var dist = respostaDistintos(e, n); if (dist) return dist;
    }
    // Custo médio por tipo de veículo
    if (/\b(custo|preco|valor|ticket) medio\b|\bmais caro|\bmais barato|\bcusta mais\b|\bquanto custa\b/.test(n) && (e.veic === 'ambos' || /eletric/.test(n) && /euro/.test(n) || /\bcompar|\bversus|\bx\b|\bvs\b|\bdiferenca\b/.test(n))) {
      var cx = respostaCustoPorTipo(e); if (cx) return cx;
    }
    // Participação ("qual a participação de SP nos elétricos")
    if (temAlgum(n, ['participacao', 'percentual', 'porcentagem', 'quanto representa', 'quanto %', 'fatia', 'proporcao', 'share']) || /%/.test(original)) {
      if (dim && dimensaoCoerente(dim, e) && !e.cidades.length && !e.proponentes.length && !(dim === 'agente' && e.agentes.length) && !(dim === 'frente' && e.frente)) {
        return respostaRanking(e, n, dim, metrica, !!superlativoMin && !superlativoMax);
      }
      return respostaValor(e, n, metrica, true);
    }

    // Comparação (dois valores da mesma dimensão, sem superlativo)
    if (!superlativoMax && !superlativoMin || temAlgum(n, ['compare', 'comparar', 'comparacao', 'versus', 'x', 'vs'])) {
      var cmp = respostaComparar(e, n, metrica);
      if (cmp) return cmp;
    }

    // Ranking: dimensão + superlativo, ou "qual <dimensão>" ou "por <dimensão>"
    var pedeQual = temAlgum(n, ['qual', 'quais', 'que', 'quem', 'onde']);
    var porDim = dim && temAlgum(n, ['por', 'cada', 'ranking', 'distribuicao', 'divisao']);
    if (dim && (superlativoMax || superlativoMin || porDim || (pedeQual && !e.cidades.length && !e.proponentes.length && dimensaoCoerente(dim, e)))) {
      return respostaRanking(e, n, dim, metrica, !!superlativoMin && !superlativoMax);
    }
    // Superlativo sem dimensão explícita ("quem contratou mais?" já cai em proponente; "onde")
    if ((superlativoMax || superlativoMin) && !dim && (temAlgum(n, ['onde', 'lugar', 'local']))) {
      return respostaRanking(e, n, 'uf', metrica, !!superlativoMin && !superlativoMax);
    }
    // Superlativo + tipo de veículo/valor sem dimensão: assume estado
    if ((superlativoMax || superlativoMin) && !dim && (e.veic || temAlgum(n, ['investimento', 'valor']))) {
      return respostaRanking(e, n, 'uf', metrica, !!superlativoMin && !superlativoMax);
    }

    // Lista de propostas
    if (temAlgum(n, ['liste', 'listar', 'lista', 'mostre', 'mostrar', 'relacao', 'quais propostas', 'quais as propostas', 'quais sao as propostas', 'quais contratos']) && !(e.cidades.length || e.proponentes.length)) {
      return respostaLista(e, n);
    }

    // Ficha de cidade/empresa
    if (e.cidades.length || e.proponentes.length) {
      if (temAlgum(n, ['quanto', 'quantos', 'quantas', 'valor', 'investimento', 'total']) && (e.veic || temAlgum(n, ['investimento', 'valor'])) && !temAlgum(n, ['propostas', 'proposta'])) return respostaValor(e, n, metrica);
      return respostaFicha(e);
    }

    // Totais ("quanto", "quantos", "total de")
    if (temAlgum(n, ['quanto', 'quantos', 'quantas', 'qual o total', 'qual a quantidade', 'total', 'total de', 'numero de', 'soma', 'somam', 'somar'])) {
      return respostaValor(e, n, metrica);
    }

    // Conceito sem "o que é"
    var c2 = melhorConceito(n); if (c2 && n.split(' ').length <= 5) return respostaConceito(c2);

    // Última chance: pergunta curta com entidade (ex.: "Minas Gerais", "elétricos em SP")
    if (e.ufs.length || e.regioes.length || e.veic || e.anos.length || e.frente || e.agentes.length || e.cat) return respostaValor(e, n, metrica);

    return respostaAjuda('Não consegui entender a pergunta, então não vou chutar um número.');
  }

  function dimensaoCoerente(dim, e) {
    // "Qual estado..." com UF já fixada fica estranho: só ranqueia se a dimensão não estiver já filtrada
    if (dim === 'uf' && e.ufs.length) return false;
    if (dim === 'regiao' && e.regioes.length) return false;
    return true;
  }

  /* ======================================================================
     8. INTERFACE
     ====================================================================== */
  var ui = {};
  function el(tag, cls, html) { var x = document.createElement(tag); if (cls) x.className = cls; if (html != null) x.innerHTML = html; return x; }

  function criarBotaoAcao(a) {
    var b = el('a', 'agente__acao', esc(a.rotulo)); b.href = a.href; return b;
  }
  function adicionar(classe, conteudo) {
    var m = el('div', 'agente__msg ' + classe, conteudo);
    ui.log.appendChild(m); ui.log.scrollTop = ui.log.scrollHeight; return m;
  }
  function mostrarSugestoes(lista) {
    ui.sug.innerHTML = '';
    (lista || []).forEach(function (t) {
      var c = el('button', 'agente__chip', esc(t)); c.type = 'button';
      c.addEventListener('click', function () { perguntar(t); });
      ui.sug.appendChild(c);
    });
  }
  function perguntar(texto) {
    texto = String(texto || '').trim(); if (!texto) return;
    adicionar('agente__msg--eu', esc(texto));
    ui.entrada.value = '';
    var r;
    try { r = responder(texto); } catch (err) { console.error(err); r = respostaAjuda('Tive um problema para calcular essa resposta.'); }
    var m = adicionar('agente__msg--bot', r.html);
    if (r.acoes && r.acoes.length) {
      var bar = el('div', 'agente__acoes'); r.acoes.forEach(function (a) { bar.appendChild(criarBotaoAcao(a)); }); m.appendChild(bar);
    }
    mostrarSugestoes(r.sugestoes);
    ui.log.scrollTop = ui.log.scrollHeight;
  }
  function abrir() { ui.painel.hidden = false; ui.fab.setAttribute('aria-expanded', 'true'); ui.entrada.focus(); }
  function fechar() { ui.painel.hidden = true; ui.fab.setAttribute('aria-expanded', 'false'); ui.fab.focus(); }

  function montarUI() {
    var css = el('style', null, ESTILO); document.head.appendChild(css);
    ui.fab = el('button', 'agente__fab', '<span aria-hidden="true">💬</span> Dúvidas');
    ui.fab.type = 'button'; ui.fab.setAttribute('aria-haspopup', 'dialog'); ui.fab.setAttribute('aria-expanded', 'false');
    ui.fab.setAttribute('aria-label', 'Abrir o Agente de Dúvidas');
    ui.painel = el('section', 'agente__painel'); ui.painel.hidden = true; ui.painel.setAttribute('role', 'dialog'); ui.painel.setAttribute('aria-label', 'Agente de Dúvidas');
    var cab = el('header', 'agente__cab', '<div><div class="agente__tit">Agente de Dúvidas</div><div class="agente__sub">Refrota · base de ' + esc(dataBase()) + ' · roda no seu navegador</div></div>');
    var fx = el('button', 'agente__fechar', '×'); fx.type = 'button'; fx.setAttribute('aria-label', 'Fechar'); fx.addEventListener('click', fechar); cab.appendChild(fx);
    ui.log = el('div', 'agente__log'); ui.log.setAttribute('aria-live', 'polite');
    ui.sug = el('div', 'agente__sug');
    var form = el('form', 'agente__form');
    ui.entrada = el('input', 'agente__entrada'); ui.entrada.type = 'text'; ui.entrada.placeholder = 'Pergunte sobre o painel…'; ui.entrada.setAttribute('aria-label', 'Sua pergunta'); ui.entrada.autocomplete = 'off';
    var env = el('button', 'agente__enviar', 'Enviar'); env.type = 'submit';
    form.appendChild(ui.entrada); form.appendChild(env);
    form.addEventListener('submit', function (ev) { ev.preventDefault(); perguntar(ui.entrada.value); });
    ui.painel.appendChild(cab); ui.painel.appendChild(ui.log); ui.painel.appendChild(ui.sug); ui.painel.appendChild(form);
    document.body.appendChild(ui.fab); document.body.appendChild(ui.painel);
    ui.fab.addEventListener('click', function () { ui.painel.hidden ? abrir() : fechar(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !ui.painel.hidden) fechar(); });
    adicionar('agente__msg--bot', '<p>Olá! Sou o Agente de Dúvidas do painel Refrota. Respondo com os números da <b>mesma base</b> do painel — e sempre mostro o recorte e a regra usada. Experimente:</p>');
    mostrarSugestoes(SUGESTOES_BASE);
  }

  var ESTILO = '' +
    '.agente__fab{position:fixed;right:20px;bottom:20px;z-index:9000;background:#0052cc;color:#fff;border:0;border-radius:999px;padding:12px 18px;font:600 13px/1 inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:inline-flex;gap:8px;align-items:center}' +
    '.agente__fab:hover{background:#003d99}.agente__fab:focus-visible,.agente__chip:focus-visible,.agente__enviar:focus-visible,.agente__fechar:focus-visible,.agente__acao:focus-visible,.agente__entrada:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}' +
    '.agente__painel{position:fixed;right:20px;bottom:76px;z-index:9001;width:420px;max-width:calc(100vw - 24px);height:600px;max-height:calc(100vh - 100px);background:var(--bg-primary,#fff);color:var(--text-primary,#1f2937);border:1px solid var(--border-color,#e5e7eb);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;font-size:13px}' +
    '.agente__painel[hidden]{display:none}' +
    '.agente__cab{background:#0052cc;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:flex-start}.agente__tit{font-weight:700;font-size:15px}.agente__sub{font-size:11px;opacity:.85;margin-top:2px}' +
    '.agente__fechar{background:transparent;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:0 4px}' +
    '.agente__log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--bg-secondary,#f9fafb)}' +
    '.agente__msg{max-width:94%;padding:9px 12px;border-radius:12px;line-height:1.45;word-wrap:break-word}.agente__msg p{margin:0 0 6px}.agente__msg p:last-child{margin-bottom:0}' +
    '.agente__msg--eu{align-self:flex-end;background:#0052cc;color:#fff}.agente__msg--bot{align-self:flex-start;background:var(--bg-primary,#fff);border:1px solid var(--border-color,#e5e7eb)}' +
    '.agente__tab{width:100%;border-collapse:collapse;margin:6px 0;font-size:12px}.agente__tab th,.agente__tab td{padding:4px 6px;border-bottom:1px solid var(--border-color,#e5e7eb);text-align:left}.agente__tab th{font-weight:600;color:var(--text-secondary,#666)}.agente__tab .n{text-align:right;white-space:nowrap}' +
    '.agente__fonte{margin-top:8px;padding-top:6px;border-top:1px dashed var(--border-color,#e5e7eb);font-size:11px;color:var(--text-secondary,#666)}.agente__mini{font-size:11px;color:var(--text-secondary,#666)}' +
    '.agente__lista{margin:4px 0 0 16px;padding:0}.agente__lista li{margin-bottom:4px}' +
    '.agente__acoes{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}.agente__acao{display:inline-block;font-size:11px;font-weight:600;color:#0052cc;border:1px solid #cfe0f5;background:#fff;border-radius:999px;padding:5px 10px;text-decoration:none}.agente__acao:hover{background:#eaf1fb;border-color:#0052cc}' +
    '.agente__sug{padding:8px 12px 0;display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow-y:auto;background:var(--bg-primary,#fff)}' +
    '.agente__chip{font-size:11px;background:var(--bg-primary,#fff);color:#0052cc;border:1px solid #cfe0f5;border-radius:999px;padding:5px 10px;cursor:pointer}.agente__chip:hover{background:#eaf1fb}' +
    '.agente__form{display:flex;gap:8px;padding:10px 12px;background:var(--bg-primary,#fff)}.agente__entrada{flex:1;padding:9px 10px;border:1px solid var(--border-color,#e5e7eb);border-radius:8px;font-size:13px;background:var(--bg-primary,#fff);color:inherit}' +
    '.agente__enviar{background:#0052cc;color:#fff;border:0;border-radius:8px;padding:0 14px;font-weight:600;cursor:pointer}' +
    '@media(max-width:520px){.agente__painel{right:8px;left:8px;width:auto;bottom:70px;height:calc(100vh - 90px)}.agente__fab{right:12px;bottom:12px}}' +
    '@media print{.agente__fab,.agente__painel{display:none!important}}';

  /* ======================================================================
     9. AUTO-CONFERÊNCIA com o painel + inicialização
     ====================================================================== */
  function autoConferir() {
    try {
      if (typeof DADOS === 'undefined' || !DADOS.consolidado) return;
      var c = DADOS.consolidado;
      var t = totais(escopo(extrairEntidades('contratadas')));
      var ts = totais(escopo(extrairEntidades('selecionadas')));
      var ok = t.propostas === c.projetos.contratados.propostas && t.veiculos === (c.veiculos.eletricos + c.veiculos.euro6 + c.veiculos.trilhos) &&
               ts.propostas === c.projetos.selecionados.propostas && Math.abs(t.investimento - c.projetos.contratados.investimento) < 1;
      if (!ok) console.warn('[Agente] ATENÇÃO: a base do agente não fecha com os totais do painel. Gere novamente base_agente.js (gerar_agente.py).', t, c);
    } catch (err) { console.warn('[Agente] conferência não executada', err); }
  }

  window.Agente = { responder: responder, base: R, totais: totais, extrairEntidades: extrairEntidades, escopo: escopo };
  function iniciar() { montarUI(); autoConferir(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
