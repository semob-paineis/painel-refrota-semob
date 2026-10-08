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
  // apelidos: "Banco Mercedes Benz do Brasil S/A" também responde a "Mercedes Benz", "Mercedes"; "BTG Pactual" a "BTG"
  (function () {
    var todos = Object.keys(AGENTES), apelidos = {};
    todos.forEach(function (k) {
      var nome = AGENTES[k];
      var x = k.replace(/\b(do brasil|s a|sa|ltda)\b/g, ' ').replace(/\s+/g, ' ').trim();
      var y = x.replace(/^banco (do estado d[oa] |d[oae] )?/, '').trim();
      [x, y, y.split(' ')[0], y.split(' ').slice(-1)[0]].forEach(function (a) {
        if (!a || a === k || a.length < 3 || ['banco', 'brasil', 'estado', 'rio', 'sul', 'grande', 'luso'].indexOf(a) >= 0) return;
        (apelidos[a] = apelidos[a] || {})[nome] = 1;
      });
    });
    Object.keys(apelidos).forEach(function (a) {
      var donos = Object.keys(apelidos[a]);
      if (donos.length === 1 && !AGENTES[a]) AGENTES[a] = donos[0];
    });
  })();

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

    Object.keys(AGENTES).sort(function (a, b) { return b.length - a.length; }).forEach(function (a) { if (a.length >= 3 && tem(n, a) && e.agentes.indexOf(AGENTES[a]) < 0) e.agentes.push(AGENTES[a]); });
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
    e.entregue = !!temAlgum(n, ['entregue', 'entregues', 'entrega', 'entregas', 'entregaram', 'entregou', 'entregar', 'em operacao', 'rodando']);
    e.desembolso = !!temAlgum(n, ['desembolsado', 'desembolsados', 'desembolsada', 'desembolsadas', 'desembolso', 'desembolsos', 'desembolsou', 'desembolsaram', 'desembolsar', 'liberado', 'liberados', 'liberou', 'liberacao', 'pago', 'pagos', 'pagou', 'repassou']);
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
  /** Fatia (0..1) do tipo de veículo pedido dentro da linha. Sem tipo => 1. forcaC: usa colunas "contratado". */
  function compTipo(r, s, forcaC) {
    if (!s.veic) return 1;
    var c = forcaC || usaContratado(s);
    var el = c ? r.elContr : r.elSel, e6 = c ? r.e6Contr : r.e6Sel, tr = c ? r.trContr : r.trSel;
    var tot = el + e6 + tr; if (!tot) return 0;
    var q = s.veic === 'el' ? el : s.veic === 'e6' ? e6 : s.veic === 'tr' ? tr : s.veic === 'ambos' ? el + e6 : 0;
    return q / tot;
  }
  /** Valor da linha. Com tipo de veículo, o valor do contrato é rateado pela fatia desse tipo (só 2 contratos são mistos). */
  function invLinha(r, s) { return (usaContratado(s) ? r.valorContr : r.apoio) * compTipo(r, s); }
  function soma(linhas, f) { var t = 0; linhas.forEach(function (r) { t += f(r); }); return t; }

  /** Agrega um conjunto de linhas conforme o recorte (única fonte dos números). */
  function agrega(L, s) {
    var contr = soma(L, function (r) { return r.qtdContr; });
    var cT = function (r) { return compTipo(r, s, true); };
    var a = {
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
      entregues: soma(L, function (r) { return r.qtdEntregue; }),
      // versões "do tipo pedido" (iguais às totais quando não há tipo de veículo no recorte)
      valorContrTipo: soma(L, function (r) { return r.valorContr * cT(r); }),
      contrTipo: soma(L, function (r) { return r.qtdContr * cT(r); }),
      entreguesTipo: soma(L, function (r) { return r.qtdEntregue * cT(r); }),
      liberadoTipo: soma(L, function (r) { return r.liberado * cT(r); }),
      mistos: s.veic ? L.filter(function (r) { var f = cT(r); return f > 0 && f < 1; }).length : 0
    };
    // Entregas: contratos com veículo entregue e valor proporcional (valor contratado x % entregue)
    var E = L.filter(function (r) { return r.qtdEntregue > 0 && cT(r) > 0; });
    a.entContratos = E.length;
    a.entValorContratos = soma(E, function (r) { return r.valorContr * cT(r); });
    a.entValorProporcional = soma(E, function (r) { return r.qtdContr ? r.valorContr * cT(r) * Math.min(r.qtdEntregue / r.qtdContr, 1) : 0; });
    a.entLiberado = soma(E, function (r) { return r.liberado * cT(r); });
    var P = E.filter(function (r) { return r.qtdEntregue >= r.qtdContr; });
    a.entContratosPlenos = P.length;
    a.entValorPlenos = soma(P, function (r) { return r.valorContr * cT(r); });
    a.pendentes = soma(L, function (r) { return Math.max(r.qtdContr - r.qtdEntregue, 0) * cT(r); });
    return a;
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
    execucao:  { chave: function (r) { return r.execucao || 'não informada'; }, rotulo: 'Situação da execução', singular: 'situação da execução', nome: function (k) { return k; } },
    fonte:     { chave: function (r) { return r.fonte || 'não informada'; }, rotulo: 'Fonte', singular: 'fonte de recursos', nome: function (k) { return k; } }
  };

  var METRICAS = {
    veiculos:    { rotulo: 'veículos', f: function (t) { return t.veiculos; }, fmt: int },
    el:          { rotulo: 'ônibus elétricos', f: function (t) { return t.el; }, fmt: int },
    e6:          { rotulo: 'ônibus Euro 6', f: function (t) { return t.e6; }, fmt: int },
    tr:          { rotulo: 'veículos sobre trilhos', f: function (t) { return t.tr; }, fmt: int },
    investimento:{ rotulo: 'investimento', f: function (t) { return t.investimento; }, fmt: moeda },
    propostas:   { rotulo: 'propostas', f: function (t) { return t.propostas; }, fmt: int },
    entregues:   { rotulo: 'veículos entregues', f: function (t) { return t.entreguesTipo; }, fmt: int },
    pendentes:   { rotulo: 'veículos contratados ainda não entregues', f: function (t) { return t.pendentes; }, fmt: int, contratada: true },
    valorEntregue: { rotulo: 'valor proporcional aos veículos entregues', f: function (t) { return t.entValorProporcional; }, fmt: moeda, contratada: true },
    liberado:    { rotulo: 'valor desembolsado', f: function (t) { return t.liberadoTipo; }, fmt: moeda },
    taxaEntrega: { rotulo: 'taxa de entrega (veículos entregues ÷ contratados)', f: function (t) { return t.contrTipo ? t.entreguesTipo / t.contrTipo : 0; }, fmt: pct, ratio: true, den: function (t) { return t.contrTipo; }, contratada: true },
    taxaDesembolso: { rotulo: 'taxa de desembolso (valor liberado ÷ valor contratado)', f: function (t) { return t.valorContrTipo ? t.liberadoTipo / t.valorContrTipo : 0; }, fmt: pct, ratio: true, den: function (t) { return t.valorContrTipo; }, contratada: true },
    medio:       { rotulo: 'valor contratado médio por veículo', f: function (t) { return t.contrTipo ? t.valorContrTipo / t.contrTipo : 0; }, fmt: moeda, ratio: true, den: function (t) { return t.contrTipo; }, contratada: true }
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
    if (temAlgum(n, ['situacao da execucao', 'execucao', 'andamento das obras', 'fase de entrega'])) return 'execucao';
    if (temAlgum(n, ['situacao', 'situacoes', 'status'])) return 'situacao';
    return null;
  }
  function pedeValor(n, original) { return /\b(invest\w*|valor\w*|recurso\w*|reais|dinheiro|bilho\w*|milho\w*|apoio|gast\w*|custo\w*|custa\w*|custou|orcamento|montante)\b/.test(n) || /r\$/i.test(original || ''); }
  function metricaDaPergunta(n, e, original) {
    if (/\b(taxa|percentual|indice|ritmo|proporcao|porcentagem) (de |dos? )?(entreg\w*)|\bmais atrasad|\batraso/.test(n)) return 'taxaEntrega';
    if (/\b(faltam?|falta|restam?|resta|pendentes?|saldo|ainda)\b.*\b(ser )?entreg\w*|\ba entregar\b|\bnao entregues?\b|\bainda nao (foram |foi )?entreg\w*/.test(n) && !/\bmeta\b/.test(n)) return 'pendentes';
    if (/\b(taxa|percentual|indice|proporcao|porcentagem) (de |do |da )?(desembols\w*|liberad\w*|liberacao)/.test(n) || (e.desembolso && /\b(percentual|taxa|proporcao|porcentagem|quanto representa|representa|sobre o valor contratado|do total contratado|do valor contratado|do contratado)\b/.test(n) && !/\b(banco|agente|caixa|bndes)\b/.test(n) && /contratad/.test(n))) return 'taxaDesembolso';
    if (/\b(custo|preco|valor|ticket) medio|\bpor (veiculo|onibus)\b|\bmais caro|\bmais barato|\bquanto custa\b/.test(n)) return 'medio';
    var valor = pedeValor(n, original);
    if (e.desembolso) return 'liberado';
    if (valor && e.entregue) return 'valorEntregue';
    if (valor) return 'investimento';           // tipo de veículo vira filtro (valor rateado por tipo)
    if (e.entregue) return 'entregues';
    if (e.veic === 'el') return 'el';
    if (e.veic === 'e6') return 'e6';
    if (e.veic === 'tr') return 'tr';
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

  function rotuloTipo(t) { return { el: 'ônibus elétricos', e6: 'ônibus Euro 6', tr: 'veículos sobre trilhos', ambos: 'ônibus elétricos e Euro 6' }[t] || 'veículos'; }
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
        if (metrica === 'taxaEntrega') html += '<p class="agente__mini">' + int(t.entreguesTipo) + ' veículos entregues de ' + int(t.contrTipo) + ' contratados.</p>';
        if (metrica === 'taxaDesembolso') html += '<p class="agente__mini">' + moeda(t.liberadoTipo) + ' liberados de ' + moeda(t.valorContrTipo) + ' contratados.</p>';
        if (metrica === 'medio') html += '<p class="agente__mini">' + moeda(t.valorContrTipo) + ' contratados para ' + int(t.contrTipo) + ' veículos' + (s.veic ? ' (valor rateado por tipo nos ' + t.mistos + ' contratos mistos)' : '') + '.</p>';
      } else if (metrica === 'propostas') {
        html = '<p>São <b>' + plural(t.propostas, 'proposta', 'propostas') + '</b>' + (geo ? ' (' + esc(geo) + ')' : '') + ' neste recorte, somando <b>' + int(t.veiculos) + '</b> veículos e <b>' + moeda(t.investimento) + '</b>.' + ctxTxt + '</p>';
      } else {
        html = '<p>' + (metrica === 'investimento' ? 'O investimento' + (s.veic ? ' em ' + rotuloTipo(s.veic) : '') + ' é de ' : 'São ') + '<b>' + M.fmt(v) + '</b>' +
          (metrica === 'investimento' ? '' : ' ' + esc(M.rotulo)) + (geo ? ' — ' + esc(geo) : '') + ', em <b>' + plural(nProp, 'proposta', 'propostas') + '</b>.' + ctxTxt + '</p>';
        if (metrica === 'investimento' && s.veic) {
          html += '<p class="agente__mini">' + (usaContratado(s) ? 'Valor contratado' : 'Apoio previsto') + ' dos contratos com ' + esc(rotuloTipo(s.veic)) + ', rateado pela fatia desse tipo de veículo' + (t.mistos ? ' (' + plural(t.mistos, 'contrato misto', 'contratos mistos') + ')' : '; nenhum contrato misto neste recorte') + '. Isso dá ' + moeda(t.veiculos ? v / t.veiculos : 0) + ' por veículo.</p>';
        }
        if (!s.veic && metrica === 'veiculos') {
          html += '<p class="agente__mini">Composição: ' + int(t.el) + ' elétricos · ' + int(t.e6) + ' Euro 6 · ' + int(t.tr) + ' sobre trilhos.</p>';
        }
        if (metrica !== 'investimento' && !s.veic && metrica !== 'propostas') {
          html += '<p class="agente__mini">' + (usaContratado(s) ? 'Valor contratado' : 'Apoio previsto') + ': ' + moeda(t.investimento) + '.</p>';
        }
      }
      html += rodape(s);
      if (metrica === 'taxaEntrega' || metrica === 'entregues') html += notaPainelEntregas(s);
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
     6b. O PAINEL EM SI — cards, números exibidos, entregas, metas
     O agente conhece cada card (o que mostra, regra, valor atual) e sabe
     reconhecer um número citado ("esses 4.550 veículos") como parte do painel.
     ====================================================================== */
  var NOME_CEN = { consolidado: 'Consolidado', publico: 'Refrota Público', privado: 'Refrota Privado' };
  function dpainel() { return (typeof DADOS !== 'undefined' && DADOS) ? DADOS : null; }
  function cenarioPainel() { try { return (typeof cenarioAtual !== 'undefined' && cenarioAtual) || 'consolidado'; } catch (x) { return 'consolidado'; } }
  function seletorPainel() { try { return (typeof tipoProjetoMapa !== 'undefined' && tipoProjetoMapa) || 'contratados'; } catch (x) { return 'contratados'; } }
  function metaEntrega() { try { return (typeof META_ENTREGA !== 'undefined' && META_ENTREGA) || 5000; } catch (x) { return 5000; } }
  function somaTipos(v) { return (v ? (v.eletricos || 0) + (v.euro6 || 0) + (v.trilhos || 0) : 0); }
  function frenteDoCenario(c) { return c === 'privado' ? 'Privado' : c === 'publico' ? 'Público' : null; }
  /** Números do painel para um cenário (vêm do dados.json que alimenta os cards). */
  function painel(c) {
    var d = dpainel(), x = d && d[c];
    if (!x) return null;
    return { cen: c, ent: x.veiculosEntregues || { eletricos: 0, euro6: 0, trilhos: 0 }, vc: x.veiculos, vs: x.veiculosSelecionados,
             proj: x.projetos, meta: x.meta2026 };
  }
  function cenarioEscolhido(e, citou) {
    var f = e && e.frente;
    if (f === 'Privado') return 'privado';
    if (f === 'Público') return 'publico';
    return citou ? cenarioPainel() : 'consolidado';
  }
  function linhasDoCenario(c) {
    var f = frenteDoCenario(c);
    return R.filter(function (r) { return r.cat === 'contratada' && (!f || r.frente === f); });
  }
  function pctf(v) { return pct(v); }

  /* ---------- Números do painel (para reconhecer "esses 4.550 veículos") ---------- */
  var _numCache = null;
  function numerosDoPainel() {
    if (_numCache) return _numCache;
    var lista = [];
    ['consolidado', 'publico', 'privado'].forEach(function (c) {
      var P = painel(c); if (!P) return;
      var add = function (valor, rotulo, card, force) { if (valor >= 100) lista.push({ valor: Math.round(valor), rotulo: rotulo, card: card, cen: c, force: force || {} }); };
      add(somaTipos(P.ent), 'veículos entregues', 'metaEntregas', { entregue: true });
      add(P.ent.eletricos, 'ônibus elétricos entregues', 'metaEntregas', { entregue: true, veic: 'el' });
      add(P.ent.euro6, 'ônibus Euro 6 entregues', 'metaEntregas', { entregue: true, veic: 'e6' });
      add(somaTipos(P.vc), 'veículos contratados', 'veiculosContratados', { cat: 'contratada' });
      add(P.vc.eletricos, 'ônibus elétricos contratados', 'veiculosContratados', { cat: 'contratada', veic: 'el' });
      add(P.vc.euro6, 'ônibus Euro 6 contratados', 'veiculosContratados', { cat: 'contratada', veic: 'e6' });
      add(somaTipos(P.vs), 'veículos selecionados', 'funil', { cat: 'selecionada' });
      add(P.proj.contratados.propostas, 'propostas contratadas', 'contratadas', { cat: 'contratada', tipo: 'propostas' });
      add(P.proj.selecionados.propostas, 'propostas selecionadas', 'selecionadas', { cat: 'selecionada', tipo: 'propostas' });
      add(P.meta && P.meta.realizado, 'veículos selecionados no ano de 2026 (Refrota Privado)', 'metaSelecionados', { meta: 'selecionados' });
    });
    _numCache = lista; return lista;
  }
  /** Acha números do texto que correspondem a um número exibido no painel. */
  function resolverNumeros(original, n, cenAtivo) {
    var achados = [];
    var re = /\d{1,3}(?:\.\d{3})+|\d{3,}/g, m;
    while ((m = re.exec(original))) {
      var v = parseInt(m[0].replace(/\./g, ''), 10);
      if (v >= 2022 && v <= 2035 && m[0].indexOf('.') < 0) continue;      // ano
      var cand = numerosDoPainel().filter(function (x) { return x.valor === v; });
      if (!cand.length) continue;
      // desempate: palavras do rótulo presentes na pergunta; depois, o cenário ativo no painel
      var pontua = function (x) {
        var p = 0;
        norm(x.rotulo).split(' ').forEach(function (w) { if (w.length > 3 && tem(n, w)) p += 2; if (w.length > 4 && n.indexOf(w.slice(0, 5)) >= 0) p += 1; });
        if (x.cen === cenAtivo) p += 1.5;
        if (x.cen === 'consolidado') p += 0.5;
        return p;
      };
      cand.sort(function (a, b) { return pontua(b) - pontua(a); });
      achados.push({ texto: m[0], valor: v, item: cand[0] });
    }
    return achados;
  }

  /* ---------- Cards do painel ---------- */
  function listaVal(c) { var P = painel(c); return P; }
  var CARTOES = [
    { id: 'metaEntregas', titulo: 'Meta Quantidade de Veículos Entregues',
      chaves: ['meta quantidade de veiculos entregues', 'meta de veiculos entregues', 'meta de entregas', 'meta de entrega', 'meta das entregas', 'card de entregas', 'indicador de entregas'],
      mostra: 'Quantos veículos já foram entregues em relação à meta de 5.000 unidades. O percentual no centro é “entregues ÷ meta”; ao passar o mouse sobre o anel azul aparece a divisão por tipo de veículo (elétricos, Euro 6 e sobre trilhos).',
      calculo: 'Soma de veículos entregues (“Qtd. entregue” de cada contrato) no cenário escolhido (Consolidado, Público ou Privado), dividida pela meta de 5.000 unidades. A divisão por tipo usa os ajustes manuais do painel (Norte).' },
    { id: 'metaSelecionados', titulo: 'Meta Quantidade de Veículos Selecionados - Refrota Privado - Ano 2026',
      chaves: ['meta quantidade de veiculos selecionados', 'meta de veiculos selecionados', 'meta 2026', 'meta de 2026', 'meta do ano'],
      mostra: 'Quantos veículos do Refrota Privado foram selecionados em 2026 em relação à meta de 5.000 unidades.',
      calculo: 'Soma dos veículos selecionados do Refrota Privado com portaria em 2026, exceto habilitadas — mesma conta nos três cenários.' },
    { id: 'veiculosContratados', titulo: 'Veículos Selecionados, Contratados e Entregues',
      chaves: ['veiculos selecionados contratados e entregues', 'distribuicao de veiculos contratados', 'grafico de veiculos contratados', 'card de veiculos contratados', 'odometro'],
      mostra: 'Um odômetro com o semicírculo inteiro = veículos selecionados; a faixa azul e o ponteiro = veículos contratados (% dos selecionados); o arco externo = divisão dos contratados em elétricos, Euro 6 e trilhos; o arco interno = veículos entregues (% dos contratados).',
      calculo: 'Os mesmos números do funil: selecionados e contratados por tipo do cenário escolhido; entregues vêm do bloco de veículos entregues.' },
    { id: 'selecionadas', titulo: 'Distribuição das Propostas Selecionadas',
      chaves: ['distribuicao das propostas selecionadas', 'propostas selecionadas card', 'card de propostas selecionadas', 'card das propostas selecionadas'],
      mostra: 'O investimento (apoio previsto do Novo PAC) e o número de propostas da carteira selecionada, separados em Desistências, Selecionados e Refrota Privado.',
      calculo: 'Selecionadas = todas as propostas, exceto as habilitadas (contratadas + em preparação + a cancelar + canceladas). Valor = apoio previsto.' },
    { id: 'contratadas', titulo: 'Distribuição das Propostas Contratadas',
      chaves: ['distribuicao das propostas contratadas', 'card de propostas contratadas', 'card das propostas contratadas'],
      mostra: 'O investimento contratado e o número de propostas contratadas, por frente (Refrota Público e Refrota Privado).',
      calculo: 'Contratada = situação Contratada, Em licitação, Em andamento ou Concluída. O valor exibido é o valor contratado.' },
    { id: 'funil', titulo: 'Funil de Conversão',
      chaves: ['funil de conversao', 'funil'],
      mostra: 'Da carteira selecionada até a entrega: quanto virou contrato, quanto ainda está a contratar, quanto é desistência e quanto já foi entregue (em R$ e em veículos).',
      calculo: 'Selecionados → Contratados / A contratar / Desistência; só os contratados seguem até Entregues. O funil em R$ não tem estágio “Entregues”, porque a planilha não registra valor por veículo entregue.' },
    { id: 'regiao', titulo: 'Contratações por Região',
      chaves: ['contratacoes por regiao', 'selecoes por regiao', 'card de regiao', 'tabela de regiao', 'tabela por regiao'],
      mostra: 'Propostas, veículos e investimento por região, com a participação de cada uma no valor total. Segue os seletores Selecionadas/Contratadas e Consolidado/Público/Privado.',
      calculo: 'Soma das propostas por região do proponente.' },
    { id: 'ano', titulo: 'Evolução de Contratações por Ano',
      chaves: ['evolucao de contratacoes por ano', 'evolucao de selecoes por ano', 'card de ano', 'grafico por ano'],
      mostra: 'Propostas, veículos e investimento por ano, com a linha de acumulado de veículos.',
      calculo: 'O ano é o da portaria de seleção, não o da assinatura do contrato.' },
    { id: 'agentes', titulo: 'Contratações por Agente Financeiro',
      chaves: ['contratacoes por agente financeiro', 'selecoes por agente financeiro', 'card de agentes financeiros', 'card de agente financeiro', 'card dos agentes financeiros'],
      mostra: 'Ranking dos agentes financeiros (CAIXA, BNDES, Banco Mercedes-Benz etc.) com propostas, veículos, valor e participação.',
      calculo: 'Contratadas: valor contratado e veículos contratados. Selecionadas: apoio previsto e veículos selecionados, sem as habilitadas.' },
    { id: 'mapa', titulo: 'Investimento Total por Estado',
      chaves: ['investimento total por estado', 'mapa do brasil', 'card do mapa', 'mapa de investimento'],
      mostra: 'O valor por UF em mapa de intensidade e em ranking.',
      calculo: 'Valor contratado (ou apoio previsto, nas selecionadas) somado por UF.' },
    { id: 'evolucao', titulo: 'Evolução desde a Data de Referência',
      chaves: ['evolucao desde a data de referencia', 'evolucao desde a ultima atualizacao', 'card de evolucao'],
      mostra: 'Compara os indicadores de hoje com os de 31/07/2026 (data de referência fixa).',
      calculo: 'Diferença entre o dados.json atual e o baseline de 31/07/2026.' },
    { id: 'destaques', titulo: 'Destaques do Período',
      chaves: ['destaques do periodo', 'card de destaques'],
      mostra: 'Frases-resumo do que mudou desde a data de referência (novas contratações, queda da carteira em preparação etc.).',
      calculo: 'Calculados sobre a mesma data de referência do card de Evolução (31/07/2026).' },
    { id: 'resumo', titulo: 'Resumo Executivo',
      chaves: ['resumo executivo'],
      mostra: 'Texto corrido com os principais números do programa.',
      calculo: 'Preenchido a partir do cenário consolidado do dados.json.' }
  ];
  function achaCartao(n) {
    var melhor = null, pts = 0, chave = null;
    CARTOES.forEach(function (c) {
      c.chaves.forEach(function (k) { var kk = norm(k); if (tem(n, kk)) { var p = kk.split(' ').length * 10 + kk.length; if (p > pts) { pts = p; melhor = c; chave = kk; } } });
    });
    if (melhor) melhor = Object.assign({ _chave: chave }, melhor);
    return melhor;
  }

  /** Valores atuais de um card, no cenário informado. Devolve HTML. */
  function valoresDoCartao(card, c) {
    var P = painel(c), cn = NOME_CEN[c];
    if (!P) return '';
    var li = function (t) { return '<li>' + t + '</li>'; };
    var tipos = function (v) { var tt = somaTipos(v); return int(v.eletricos) + ' elétricos (' + pct(tt ? v.eletricos / tt : 0) + ') · ' + int(v.euro6) + ' Euro 6 (' + pct(tt ? v.euro6 / tt : 0) + ') · ' + int(v.trilhos) + ' sobre trilhos'; };
    var h = '';
    switch (card.id) {
      case 'metaEntregas': { var tot = somaTipos(P.ent), m = metaEntrega();
        h = li('Entregues: <b>' + int(tot) + '</b> de <b>' + int(m) + '</b> (<b>' + pct(Math.min(tot / m, 1)) + '</b>) — ' + tipos(P.ent)); break; }
      case 'metaSelecionados':
        h = li('Realizado: <b>' + int(P.meta.realizado) + '</b> de <b>' + int(P.meta.meta) + '</b> (<b>' + pct(P.meta.percentual) + '</b>)'); break;
      case 'veiculosContratados': h = li('Total: <b>' + int(somaTipos(P.vc)) + '</b> — ' + tipos(P.vc)); break;
      case 'selecionadas': h = li('<b>' + moeda(P.proj.selecionados.investimento) + '</b> em <b>' + int(P.proj.selecionados.propostas) + '</b> propostas · ' + int(P.proj.selecionados.veiculos) + ' veículos'); break;
      case 'contratadas': h = li('<b>' + moeda(P.proj.contratados.investimento) + '</b> em <b>' + int(P.proj.contratados.propostas) + '</b> propostas · ' + int(P.proj.contratados.veiculos) + ' veículos'); break;
      case 'funil': { var st = P.proj.status, sel = somaTipos(P.vs), con = somaTipos(P.vc), ent = somaTipos(P.ent);
        h = li('Veículos: <b>' + int(sel) + '</b> selecionados → <b>' + int(con) + '</b> contratados (' + pct(sel ? con / sel : 0) + ') → <b>' + int(ent) + '</b> entregues (' + pct(sel ? ent / sel : 0) + ' dos selecionados; ' + pct(con ? ent / con : 0) + ' dos contratados)') +
            li('Valor (apoio previsto): ' + moeda(st.contratados.valor) + ' contratados · ' + moeda(st.emPreparacao.valor) + ' a contratar · ' + moeda(st.aCancelar.valor + st.cancelados.valor) + ' em desistências/canceladas'); break; }
      default: return '';
    }
    return '<ul class="agente__lista">' + h + '</ul>';
  }

  function respostaCartao(card, c) {
    var h = '<p><b>' + esc(card.titulo) + '</b></p><p>' + esc(card.mostra) + '</p>';
    var v = valoresDoCartao(card, c);
    if (v) h += '<p class="agente__mini">Agora, na visão <b>' + NOME_CEN[c] + '</b>:</p>' + v;
    h += '<div class="agente__fonte"><b>Como é calculado:</b> ' + esc(card.calculo) + '</div>';
    return { html: h, fatos: { cartao: card.id, cenario: c }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  /* ---------- Dados que a base não tem ---------- */
  function temaIndisponivel(n) {
    if (/\b(prazo|tempo|dias|duracao)\b.*\b(entrega|entregue|execucao|obra)\b|\bdata (de|da|das) entrega|\bquando (foi|foram|sera|serao) entreg\w*|\bprevisao de entrega|\bcronograma|\bprazo (medio|contratual)/.test(n))
      return { tema: 'datas e prazos de entrega', tem: 'a data de assinatura do contrato, a situação da execução (por exemplo, “Equipamento em aquisição” ou “Entregue”) e a quantidade entregue', pergunta: ['Quais contratos assinados há mais tempo ainda não tiveram entrega?', 'Qual a situação da execução dos contratos?', 'Qual a taxa de entrega por região?'] };
    if (/\b(fabricante|montadora|marca|modelo|chassi|carroceria|encarrocadora)\b/.test(n))
      return { tema: 'fabricante ou modelo dos veículos', tem: 'o tipo de veículo (elétrico, Euro 6 ou sobre trilhos) e o agente financeiro de cada contrato', pergunta: ['Quantos ônibus elétricos foram contratados?', 'Qual agente financeiro contratou mais?'] };
    if (/\b(populacao|habitantes|pib|renda|passageiros|emissao|emissoes|co2|tarifa|km rodados|quilometr\w*|idade da frota)\b/.test(n))
      return { tema: 'indicadores externos ao programa (população, passageiros, emissões, tarifa, idade da frota)', tem: 'apenas dados de contratação e entrega do Refrota', pergunta: ['Qual estado tem mais veículos contratados?', 'Qual o investimento por região?'] };
    return null;
  }
  function respostaIndisponivel(t) {
    return { html: '<p>Essa informação não está na base do painel: <b>' + esc(t.tema) + '</b>. A base traz ' + esc(t.tem) + '. Prefiro não estimar um número que a planilha não registra.</p><p class="agente__mini">Posso responder, por exemplo:</p>',
             fatos: { indisponivel: t.tema }, acoes: [], sugestoes: t.pergunta };
  }

  /* ---------- Diferença entre dois números do painel ---------- */
  function respostaDiferencaNumeros(nums) {
    var A = nums[0].item, B = nums[1].item, va = nums[0].valor, vb = nums[1].valor;
    var maior = va >= vb ? A : B, menor = va >= vb ? B : A, vMaior = Math.max(va, vb), vMenor = Math.min(va, vb), dif = vMaior - vMenor;
    var par = [A.rotulo, B.rotulo].join('|');
    var h = '<p>' + esc(cap(A.rotulo)) + ' (' + NOME_CEN[A.cen] + '): <b>' + int(va) + '</b> · ' + esc(B.rotulo) + ' (' + NOME_CEN[B.cen] + '): <b>' + int(vb) + '</b> → diferença de <b>' + int(dif) + '</b> (' + esc(menor.rotulo) + ' = ' + pct(vMaior ? vMenor / vMaior : 0) + ' de ' + esc(maior.rotulo) + ').</p>';
    var P = painel('consolidado');
    var tem2 = function (a, b) { return par.indexOf(a) >= 0 && par.indexOf(b) >= 0; };
    if (tem2('veículos contratados', 'veículos entregues') && P) {
      var base = linhasDoCenario('consolidado');
      var pend = soma(base, function (r) { return Math.max(r.qtdContr - r.qtdEntregue, 0); });
      var nPend = base.filter(function (r) { return r.qtdContr > r.qtdEntregue; }).length;
      var semEnt = base.filter(function (r) { return !r.qtdEntregue; });
      h += '<p>É o <b>saldo a entregar</b>: veículos que já estão em contratos assinados, mas ainda não foram entregues — <b>' + int(pend) + '</b> veículos em ' + plural(nPend, 'contrato', 'contratos') + ' (' + plural(semEnt.length, 'deles ainda sem nenhuma entrega', 'deles ainda sem nenhuma entrega') + ', somando ' + int(soma(semEnt, function (r) { return r.qtdContr; })) + ' veículos).</p>';
    } else if (tem2('veículos selecionados', 'veículos contratados') && P) {
      var st = P.proj.status;
      h += '<p>A diferença é o que foi selecionado e <b>ainda não virou contrato</b>: ' + int(st.emPreparacao.veiculos) + ' veículos em preparação (a contratar), ' + int(st.aCancelar.veiculos) + ' em desistências (a cancelar) e ' + int(st.cancelados.veiculos) + ' em propostas canceladas.</p>';
    } else if (tem2('propostas selecionadas', 'propostas contratadas') && P) {
      var st2 = P.proj.status;
      h += '<p>As propostas selecionadas que não estão contratadas: ' + int(st2.emPreparacao.qtd) + ' em preparação, ' + int(st2.aCancelar.qtd) + ' a cancelar (desistências) e ' + int(st2.cancelados.qtd) + ' canceladas.</p>';
    }
    return { html: h, fatos: { a: va, b: vb, diferenca: dif }, acoes: [], sugestoes: SUGESTOES_BASE };
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  /* ---------- Por que Consolidado não fecha com Público + Privado ---------- */
  function respostaReconciliacao() {
    var C = painel('consolidado'), U = painel('publico'), V = painel('privado');
    if (!C || !U || !V) return null;
    var linhas = [
      ['Propostas contratadas', C.proj.contratados.propostas, U.proj.contratados.propostas, V.proj.contratados.propostas, int],
      ['Veículos contratados', somaTipos(C.vc), somaTipos(U.vc), somaTipos(V.vc), int],
      ['Veículos entregues', somaTipos(C.ent), somaTipos(U.ent), somaTipos(V.ent), int],
      ['Ônibus elétricos entregues', C.ent.eletricos, U.ent.eletricos, V.ent.eletricos, int],
      ['Ônibus Euro 6 entregues', C.ent.euro6, U.ent.euro6, V.ent.euro6, int],
      ['Meta 2026 (selecionados)', C.meta.realizado, U.meta.realizado, V.meta.realizado, int]
    ];
    var h = '<p>Comparando o <b>Consolidado</b> com a soma de <b>Público + Privado</b>, nos números dos cards:</p><table class="agente__tab"><thead><tr><th>Indicador</th><th class="n">Consolidado</th><th class="n">Público</th><th class="n">Privado</th><th class="n">Pub. + Priv.</th><th class="n">Dif.</th></tr></thead><tbody>';
    linhas.forEach(function (l) {
      var soma2 = l[2] + l[3], d = l[1] - soma2;
      h += '<tr><td>' + esc(l[0]) + '</td><td class="n">' + l[4](l[1]) + '</td><td class="n">' + l[4](l[2]) + '</td><td class="n">' + l[4](l[3]) + '</td><td class="n">' + l[4](soma2) + '</td><td class="n">' + (d ? '<b>' + (d > 0 ? '+' : '') + l[4](d) + '</b>' : '—') + '</td></tr>';
    });
    h += '</tbody></table><ul class="agente__lista">' +
      '<li><b>Meta 2026:</b> é regra do painel (confirmada) — o Consolidado conta só os veículos selecionados do Refrota Privado em 2026; por isso não soma com o Público.</li>' +
      '<li><b>Entregues:</b> o total do Consolidado (' + int(somaTipos(C.ent)) + ') bate com a base; já a visão Privado mostra ' + int(somaTipos(V.ent)) + ' e a Pública ' + int(somaTipos(U.ent)) + '. Os ajustes manuais do Norte (−40 elétricos e −225 Euro 6) aparecem em todas as visões, e o contrato misto do Governo do Pará (Refrota Público) é contado como elétrico e Euro 6 ao mesmo tempo antes do ajuste. Vale conferir na planilha se o ajuste cabe em todas as visões.</li></ul>';
    return { html: h, fatos: { reconciliacao: linhas.map(function (l) { return [l[0], l[1], l[2] + l[3]]; }) }, acoes: [], sugestoes: ['Qual a divisão por tipo dos veículos entregues?', 'Quanto falta para a meta de entregas?', 'O que é a Meta 2026?'] };
  }

  /* ---------- Entregas ---------- */
  /** Compara o painel com a base: total e divisão por tipo dos entregues (dados-chave para quem lê o card). */
  function estimativaTipoEntregues(c) {
    var L = linhasDoCenario(c);
    var f = function (campo) { return soma(L, function (r) { return r.qtdContr ? r.qtdEntregue * r[campo] / r.qtdContr : 0; }); };
    return { el: f('elContr'), e6: f('e6Contr'), tr: f('trContr'), total: soma(L, function (r) { return r.qtdEntregue; }) };
  }
  function avisoEntregas(c) {
    var P = painel(c); if (!P) return '';
    var est = estimativaTipoEntregues(c), tot = somaTipos(P.ent), partes = [];
    if (Math.abs(est.total - tot) >= 1) {
      partes.push('O card mostra <b>' + int(tot) + '</b>, mas a soma de “Qtd. entregue” na base é <b>' + int(est.total) + '</b> (diferença de ' + int(Math.abs(est.total - tot)) + ' veículos, vinda dos ajustes manuais do painel).');
    }
    if (Math.abs(est.el - P.ent.eletricos) >= 5) {
      var pa = c !== 'privado';
      partes.push('Divisão por tipo: o painel mostra <b>' + int(P.ent.eletricos) + '</b> elétricos e <b>' + int(P.ent.euro6) + '</b> Euro 6; pela composição de cada contrato (colunas “Elétricos/Euro 6 contratados”) seria cerca de <b>' + int(est.el) + '</b> e <b>' + int(est.e6) + '</b>. ' +
        (pa ? 'A diferença está no contrato do Governo do Pará (265 entregues = 40 elétricos + 225 Euro 6), de item principal “Elétrico e Euro 6”, que o painel trata com os ajustes manuais do Norte (−40 elétricos e −225 Euro 6): conferir na planilha se esses ajustes estão no sentido certo.'
            : 'Essa visão aplica os mesmos ajustes manuais do Norte (−40 elétricos e −225 Euro 6), embora o contrato do Pará seja do Refrota Público — por isso Público + Privado (' + int(somaTipos(painel('publico').ent) + somaTipos(painel('privado').ent)) + ') não fecha com o Consolidado (' + int(somaTipos(painel('consolidado').ent)) + '). Vale conferir na planilha.'));
    }
    return partes.length ? '<div class="agente__fonte"><b>Atenção:</b> ' + partes.join('<br>') + '</div>' : '';
  }
  function notaPainelEntregas(s) {
    if (s.ufs.length || s.regioes.length || s.cidades.length || s.proponentes.length || s.agentes.length || s.anos.length || s.assin || s.situacaoTexto || s.veic) return '';
    var c = s.frente === 'Privado' ? 'privado' : s.frente === 'Público' ? 'publico' : 'consolidado';
    var P = painel(c); if (!P) return '';
    var est = estimativaTipoEntregues(c).total, tot = somaTipos(P.ent);
    if (Math.abs(est - tot) < 1) return '';
    return '<p class="agente__mini">No card de entregas (' + NOME_CEN[c] + ') o total exibido é ' + int(tot) + ', porque o painel aplica ajustes manuais; a soma bruta da base é ' + int(est) + '.</p>';
  }

  function respostaMetaEntregas(e, citou) {
    var c = cenarioEscolhido(e, citou), P = painel(c), m = metaEntrega();
    var base = linhasDoCenario(c);
    var tot = P ? somaTipos(P.ent) : soma(base, function (r) { return r.qtdEntregue; });
    var v = P ? P.ent : { eletricos: soma(base, function (r) { return r.elContr * (r.qtdContr ? r.qtdEntregue / r.qtdContr : 0); }), euro6: 0, trilhos: 0 };
    var falta = Math.max(m - tot, 0);
    var pend = soma(base, function (r) { return Math.max(r.qtdContr - r.qtdEntregue, 0); });
    var nPend = base.filter(function (r) { return r.qtdContr > r.qtdEntregue; }).length;
    var porUF = {}; base.forEach(function (r) { var d = Math.max(r.qtdContr - r.qtdEntregue, 0); if (d) porUF[r.uf] = (porUF[r.uf] || 0) + d; });
    var topUF = Object.keys(porUF).sort(function (a, b) { return porUF[b] - porUF[a]; }).slice(0, 3);
    var h = '<p>No card <b>Meta Quantidade de Veículos Entregues</b> (visão <b>' + NOME_CEN[c] + '</b>) foram entregues <b>' + int(tot) + '</b> veículos de uma meta de <b>' + int(m) + '</b> unidades: <b>' + pct(Math.min(tot / m, 1)) + '</b> da meta' +
      (falta ? ', faltando <b>' + int(falta) + '</b>.' : ' — a meta foi <b>atingida</b>' + (tot > m ? ' (excedida em ' + int(tot - m) + ')' : '') + '.') + '</p>';
    h += '<ul class="agente__lista"><li><b>Por tipo (tooltip do card):</b> ' + int(v.eletricos) + ' ônibus elétricos (' + pct(tot ? v.eletricos / tot : 0) + ') · ' + int(v.euro6) + ' ônibus Euro 6 (' + pct(tot ? v.euro6 / tot : 0) + ') · ' + int(v.trilhos) + ' sobre trilhos</li>';
    h += '<li><b>Contratados e ainda não entregues:</b> ' + int(pend) + ' veículos em ' + plural(nPend, 'contrato', 'contratos') +
      (falta ? (pend >= falta ? ' — mais do que o necessário para fechar a meta (' + int(falta) + '), então ela depende só de entregas de contratos já assinados' : ' — menos do que falta para a meta (' + int(falta) + '); será preciso contratar mais') : '') + '.</li>';
    if (topUF.length) h += '<li><b>Maiores saldos a entregar:</b> ' + topUF.map(function (u) { return esc(nomeUF(u)) + ' (' + int(porUF[u]) + ')'; }).join(', ') + '.</li>';
    h += '</ul>';
    var notas = '“Entregues” = “Qtd. entregue” de cada contrato (só existem em propostas contratadas). A meta de ' + int(m) + ' unidades vale para o programa; nas visões Público e Privado cada frente é comparada com a mesma meta.';
    h += '<div class="agente__fonte">' + esc(notas) + '</div>' + avisoEntregas(c);
    return { html: h, fatos: { cartao: 'metaEntregas', entregues: tot, meta: m, faltam: falta, pendentes: pend, cenario: c }, acoes: [],
             sugestoes: ['Qual valor representa os veículos entregues?', 'Quais estados mais entregaram veículos?', 'Qual a taxa de entrega por região?', 'Quanto falta entregar em São Paulo?'] };
  }

  function nomeUF(sigla) { return NOME_COMPLETO[sigla] || sigla; }

  /** Qualquer pergunta sobre entregas que não seja ranking/taxa por dimensão. */
  function respostaEntregas(e, n, original, citou, card) {
    var s = escopo(e); if (!s.situacaoTexto) s.cat = 'contratada';
    s.entregue = true;
    var pedeVal0 = pedeValor(n, original) || /\bequivale\w*|\bvale\b|\bsaiu\b/.test(n);
    var pedeTipo0 = !s.veic && /\b(tipo|tipos|composicao|divisao|distribuicao|detalh\w*)\b/.test(n);
    var fraseMeta = /\bmeta\b|(?!\bfaltam? (ser )?entreg)\bfalta\w*\b|\batingi\w*|\balcanc\w*|\bobjetivo\b/.test(n) || !!(card && /^meta/.test(card.id) && !pedeVal0 && !pedeTipo0);
    var semFiltro = !(s.ufs.length || s.regioes.length || s.cidades.length || s.proponentes.length || s.agentes.length || s.anos.length || s.assin || s.situacaoTexto);
    if (fraseMeta && semFiltro && !s.veic) return respostaMetaEntregas(e, citou);
    var t = totais(s);
    var geo = nomeDoRecorteGeo(s);
    var rot0 = s.veic ? rotuloTipo(s.veic) : 'veículos';
    var lugar0 = geo ? ' — ' + esc(geo) : (s.frente ? ' — Refrota ' + s.frente : '');
    var pedeVal = pedeValor(n, original) || /\bequivale\w*|\brepresenta\w*\b.*\bvalor|\bvale\b|\bsaiu\b/.test(n);
    var pedeTipo = !s.veic && /\b(tipo|tipos|composicao|divisao|distribuicao|detalh\w*)\b/.test(n);
    var rot = s.veic ? rotuloTipo(s.veic) : 'veículos';
    var EN = t.entreguesTipo;
    var lugar = geo ? ' — ' + esc(geo) : (s.frente ? ' — Refrota ' + s.frente : '');
    // Perguntas específicas sobre contratos e entregas
    var Lc = t.linhas;
    var pedePart = /\b(particip\w*|represent\w*|fatia|proporcao|percentual|porcentagem)\b/.test(n) && !pedeVal0 && (s.agentes.length || s.ufs.length || s.regioes.length || s.proponentes.length || s.cidades.length || s.frente);
    if (/\b(100|cem)\b.*\bentreg\w*|\b(totalmente|integralmente|completamente|plenamente|inteiramente)\b.*\bentreg\w*|\bentreg\w*\b.*\b(totalmente|integralmente|completamente|plenamente|por completo)\b/.test(n) && /\b(contratos?|propostas?|empreendimentos?)\b/.test(n)) {
      var P1 = Lc.filter(function (r) { return r.qtdEntregue > 0 && r.qtdEntregue >= r.qtdContr; });
      var hh = '<p><b>' + plural(P1.length, 'contrato está', 'contratos estão') + '</b> com 100% dos veículos entregues, somando <b>' + int(soma(P1, function (r) { return r.qtdEntregue; })) + '</b> veículos e <b>' + moeda(soma(P1, function (r) { return r.valorContr; })) + '</b> em valor contratado. Há ainda ' + plural(t.entContratos - P1.length, 'contrato', 'contratos') + ' com entrega parcial.</p>';
      return { html: hh + rodape(s), fatos: { valor: P1.length, contratos: P1.length }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
    }
    if (/\b(sem|nenhuma|nenhum|nao tiveram|nao tem|ainda nao (tiveram|receberam|tem)|zero)\b.*\b(entrega|entregas|entregue|entregues)\b|\bnao (receberam|tiveram) (nenhum|nenhuma)?\s*(veiculo|entrega)/.test(n) && /\b(contratos?|propostas?|empreendimentos?|proponentes?|municipios?|cidades?)\b/.test(n)) {
      var Z = Lc.filter(function (r) { return !r.qtdEntregue; }).sort(function (a, b) { return String(a.assinatura || '9999').localeCompare(String(b.assinatura || '9999')); });
      var hz = '<p><b>' + plural(Z.length, 'contrato ainda não teve', 'contratos ainda não tiveram') + '</b> nenhuma entrega, com <b>' + int(soma(Z, function (r) { return r.qtdContr; })) + '</b> veículos contratados e <b>' + moeda(soma(Z, function (r) { return r.valorContr; })) + '</b> em valor. Os mais antigos (pela data de assinatura):</p>' +
        '<table class="agente__tab"><thead><tr><th>Proponente</th><th>UF</th><th>Assinatura</th><th>Execução</th><th class="n">Veíc.</th></tr></thead><tbody>' +
        Z.slice(0, 6).map(function (r) { return '<tr><td>' + esc(r.proponente) + '</td><td>' + esc(r.uf) + '</td><td>' + esc(r.assinatura ? r.assinatura.split('-').reverse().join('/') : '—') + '</td><td>' + esc(r.execucao || '—') + '</td><td class="n">' + int(r.qtdContr) + '</td></tr>'; }).join('') + '</tbody></table>';
      return { html: hz + rodape(s), fatos: { valor: Z.length, contratos: Z.length }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
    }
    if (/\b(media|medio|medias)\b/.test(n) && /\b(contrato|contratos|proposta|propostas)\b/.test(n) && t.entContratos) {
      return { html: '<p>Em média, cada contrato com entrega recebeu <b>' + int(Math.round(t.entreguesTipo / t.entContratos)) + '</b> veículos (' + int(t.entreguesTipo) + ' entregues em ' + plural(t.entContratos, 'contrato', 'contratos') + '). Considerando todos os ' + plural(t.propostas, 'contrato', 'contratos') + ' contratados do recorte, a média é de <b>' + int(Math.round(t.entreguesTipo / t.propostas)) + '</b> por contrato.</p>' + rodape(s),
               fatos: { valor: t.entreguesTipo / t.entContratos }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
    }
    if (pedePart) {
      var sb = {}; Object.keys(s).forEach(function (k) { sb[k] = s[k]; });
      sb.ufs = []; sb.regioes = []; sb.cidades = []; sb.proponentes = []; sb.agentes = []; sb.frente = null;
      var tb = totais(sb), parte = t.entreguesTipo, todo = tb.entreguesTipo;
      var quem = nomeDoRecorteGeo(s) || (s.agentes.length ? s.agentes.join(', ') : '') || (s.frente ? 'Refrota ' + s.frente : '') || 'Este recorte';
      return { html: '<p><b>' + esc(quem) + '</b> responde por <b>' + pct(todo ? parte / todo : 0) + '</b> dos veículos entregues: <b>' + int(parte) + '</b> de <b>' + int(todo) + '</b>' + (s.veic ? ' (' + esc(rotuloTipo(s.veic)) + ')' : '') + ', em ' + plural(t.entContratos, 'contrato', 'contratos') + '.</p>' + rodape(s),
               fatos: { valor: parte, base: todo }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
    }
    if (/\b(faltam?|falta|restam?|resta|pendentes?|saldo|ainda)\b.*\b(ser )?entreg\w*|\ba entregar\b|\bnao entregues?\b|\bainda nao (foram |foi )?entreg\w*/.test(n) && !/\bmeta\b/.test(n)) {
      var rk = ranking(s, 'uf', 'pendentes', false);
      var hp = '<p>Faltam entregar <b>' + int(t.pendentes) + '</b> ' + esc(rot) + ' já contratados' + lugar + ' (' + pct(t.contrTipo ? t.pendentes / t.contrTipo : 0) + ' dos ' + int(t.contrTipo) + ' contratados), em ' + plural(Lc.filter(function (r) { return r.qtdContr > r.qtdEntregue; }).length, 'contrato', 'contratos') + '.</p>';
      if (!s.ufs.length) hp += tabelaRanking(rk, 5, true);
      if (semFiltro && !s.veic) hp += '<p class="agente__mini">Para a meta de ' + int(metaEntrega()) + ' entregas, faltam ' + int(Math.max(metaEntrega() - somaTipos((painel(cenarioEscolhido(e, citou)) || { ent: {} }).ent), 0)) + ' (veja “Quanto falta para a meta de entregas?”).</p>';
      return { html: hp + rodape(s), fatos: { valor: t.pendentes, itens: rk.linhas.map(function (x) { return [x.chave, x.valor]; }) }, acoes: acoesRadar(s), sugestoes: ['Quanto falta para a meta de entregas?', 'Quais contratos ainda não tiveram nenhuma entrega?', 'Qual a taxa de entrega por região?'] };
    }
    var h = '';
    if (!t.propostas || !EN) {
      h += '<p>Não há ' + esc(rot) + ' entregues neste recorte.</p>' + rodape(s);
      return { html: h, fatos: { valor: 0, entregues: 0 }, acoes: acoesRadar(s), sugestoes: SUGESTOES_BASE };
    }
    var perc = t.contrTipo ? EN / t.contrTipo : 0;
    if (pedeVal) {
      var prop = t.entValorProporcional, contratos = t.entValorContratos, lib = t.entLiberado;
      var totContr = t.valorContrTipo;
      if (e.desembolso) {
        h += '<p>Nos contratos que já têm veículos entregues' + lugar + ' (' + plural(t.entContratos, 'contrato', 'contratos') + ', <b>' + int(EN) + '</b> ' + esc(rot) + ' entregues) já foram desembolsados <b>' + moeda(lib) + '</b>' + (contratos ? ' — ' + pct(lib / contratos) + ' dos ' + moeda(contratos) + ' contratados nesses contratos' : '') + '.</p>';
      } else {
        h += '<p>Os <b>' + int(EN) + '</b> ' + esc(rot) + ' entregues' + lugar + ' representam, em valor contratado, aproximadamente <b>' + moeda(prop) + '</b>' + (totContr ? ' (' + pct(prop / totContr) + ' dos ' + moeda(totContr) + ' contratados no recorte)' : '') + ', ou cerca de <b>' + moeda(prop / EN) + '</b> por veículo.</p>';
      }
      h += '<table class="agente__tab"><thead><tr><th>Medida</th><th class="n">Valor</th></tr></thead><tbody>' +
        '<tr><td><b>Proporcional aos veículos entregues</b><br><span class="agente__mini">valor de cada contrato × (veículos entregues ÷ contratados)</span></td><td class="n"><b>' + moeda(prop) + '</b></td></tr>' +
        '<tr><td>Valor contratado dos ' + plural(t.entContratos, 'contrato que já tem', 'contratos que já têm') + ' entrega<br><span class="agente__mini">inclui a parte ainda não entregue</span></td><td class="n">' + moeda(contratos) + '</td></tr>' +
        '<tr><td>Já desembolsado nesses contratos</td><td class="n">' + moeda(lib) + '</td></tr>' +
        '<tr><td>Contratos 100% entregues (' + int(t.entContratosPlenos) + ')</td><td class="n">' + moeda(t.entValorPlenos) + '</td></tr></tbody></table>';
      h += '<div class="agente__fonte"><b>Como ler:</b> a planilha não registra um valor por veículo entregue — só o valor de cada contrato e a quantidade entregue. Por isso o valor dos veículos entregues é uma <b>estimativa proporcional</b>: um contrato de R$ 100 mi com metade dos veículos entregues conta R$ 50 mi. ' + (s.veic ? 'Com tipo de veículo, o valor de cada contrato é rateado pela fatia do tipo. ' : '') + 'O funil em R$ do painel não tem o estágio “Entregues” justamente por isso.<br>' + esc(definicaoDoRecorte(s)) + '</div>' + notaPainelEntregas(s);
      return { html: h, fatos: { valor: prop, entregues: EN, valorContratos: contratos, liberado: lib, contratosComEntrega: t.entContratos, contratosPlenos: t.entContratosPlenos }, acoes: acoesRadar(s), sugestoes: ['Quanto falta para a meta de entregas?', 'Quais estados mais entregaram veículos?', 'Qual a taxa de entrega por região?', 'Quanto foi desembolsado no total?'] };
    }
    // Composição por tipo: números do painel quando o recorte é um cenário inteiro; estimativa por contrato nos demais
    var cen = cenarioEscolhido(e, citou);
    var P = semFiltro ? painel(cen) : null;
    var est = {
      el: soma(t.linhas, function (r) { return r.qtdContr ? r.qtdEntregue * r.elContr / r.qtdContr : 0; }),
      e6: soma(t.linhas, function (r) { return r.qtdContr ? r.qtdEntregue * r.e6Contr / r.qtdContr : 0; }),
      tr: soma(t.linhas, function (r) { return r.qtdContr ? r.qtdEntregue * r.trContr / r.qtdContr : 0; })
    };
    var fatoTipo = { el: 'eletricos', e6: 'euro6', tr: 'trilhos' };
    var tot = EN, v = { eletricos: est.el, euro6: est.e6, trilhos: est.tr }, usouPainel = false;
    if (P && !s.veic) { v = P.ent; tot = somaTipos(P.ent); usouPainel = true; }
    if (P && s.veic) { tot = P.ent[fatoTipo[s.veic]] || 0; usouPainel = true; }
    h += '<p>Foram entregues <b>' + int(tot) + '</b> ' + esc(rot) + lugar + (usouPainel ? ' (número do card, visão ' + NOME_CEN[cen] + ')' : '') + ', em <b>' + plural(t.entContratos, 'contrato', 'contratos') + '</b>' + (t.contrTipo ? ' — ' + pct(tot / t.contrTipo) + ' dos ' + int(t.contrTipo) + ' contratados no recorte' : '') + '.</p>';
    if (!s.veic) h += '<ul class="agente__lista"><li>' + int(v.eletricos) + ' ônibus elétricos (' + pct(tot ? v.eletricos / tot : 0) + ') · ' + int(v.euro6) + ' ônibus Euro 6 (' + pct(tot ? v.euro6 / tot : 0) + ') · ' + int(v.trilhos) + ' sobre trilhos' + (usouPainel ? '' : ' <span class="agente__mini">(estimativa pela composição de cada contrato)</span>') + '</li></ul>';
    if (s.veic && P) h += '<p class="agente__mini">Pela composição de cada contrato, a estimativa seria de ' + int(EN) + ' ' + esc(rot) + ' entregues.</p>';
    if (!pedeTipo) h += '<p class="agente__mini">Valor proporcional aos veículos entregues: ' + moeda(t.entValorProporcional) + ' · desembolsado nesses contratos: ' + moeda(t.entLiberado) + '. Saldo contratado a entregar: ' + int(t.pendentes) + ' veículos.</p>';
    h += rodape(s) + (P ? avisoEntregas(cen) : notaPainelEntregas(s));
    var sug = ['Qual valor representa os veículos entregues?', 'Quanto falta para a meta de entregas?', 'Quais estados mais entregaram veículos?'];
    return { html: h, fatos: { valor: tot, entregues: tot, propostas: t.entContratos, valorProporcional: t.entValorProporcional, estimativaPorContrato: EN }, acoes: acoesRadar(s), sugestoes: sug };
  }

  /** Metas: decide qual card de meta o usuário quer (ou mostra os dois). */
  function respostaMetas(e, n, citou) {
    var qEnt = /\bentreg\w*|\brecebid\w*/.test(n);
    var qSel = /\bselecion\w*|\b2026\b|\bprivad\w*|\bportaria\b|\bano\b/.test(n);
    if (qEnt && !qSel) return respostaMetaEntregas(e, citou);
    if (qSel && !qEnt) return respostaMeta();
    var a = respostaMetaEntregas(e, citou), b = respostaMeta();
    return { html: '<p>O painel tem <b>duas metas de 5.000 unidades</b>, uma para cada card:</p>' + a.html + '<hr class="agente__sep">' + b.html,
             fatos: { entregas: a.fatos, selecionados: b.fatos }, acoes: [], sugestoes: SUGESTOES_BASE };
  }

  /* ======================================================================
     7. DECISÃO
     ====================================================================== */
  var MEM = null;     // última pergunta entendida (para "e no Nordeste?")
  function ehSeguimento(n) { return /^(e|e se|e quanto|e quantos|e quantas|e em|e no|e na|e nos|e nas|e para|e do|e da|e o|e a|e os|e as|agora|e entao|tambem|idem|mesma pergunta)\b/.test(n) && n.split(' ').length <= 9; }
  function fundir(prev, nov) {
    var r = JSON.parse(JSON.stringify(prev));
    var geo = ['ufs', 'regioes', 'cidades', 'proponentes'];
    geo.forEach(function (k) { if (nov[k] && nov[k].length) { geo.forEach(function (o) { if (o !== k && o !== 'proponentes') r[o] = []; }); r[k] = nov[k]; } });
    ['agentes', 'anos', 'meses'].forEach(function (k) { if (nov[k] && nov[k].length) r[k] = nov[k]; });
    ['frente', 'veic', 'cat', 'situacaoTexto'].forEach(function (k) { if (nov[k]) r[k] = nov[k]; });
    ['assin', 'selecionada', 'entregue', 'desembolso'].forEach(function (k) { if (nov[k]) r[k] = true; });
    return r;
  }
  function responder(texto) {
    var original = String(texto || '').trim();
    var n = norm(original);
    if (!n) return respostaAjuda('');
    if (/^(oi|ola|bom dia|boa tarde|boa noite|ajuda|help|menu|o que voce faz|o que voce sabe|como funciona)\b/.test(n)) return respostaAjuda('');

    var e = extrairEntidades(original);
    var seguimento = false;
    if (MEM && ehSeguimento(n)) {
      seguimento = true;
      e = fundir(MEM.e, e);
      n = MEM.n + ' ' + n.replace(/^(e se|e quanto|e quantos|e quantas|e entao|e|agora|tambem|idem|mesma pergunta)\s+/, '');
    }
    var nBase = n, eBase = JSON.parse(JSON.stringify(e));
    var resp = rotear(original, n, e);
    if (resp && resp.fatos && !resp.fatos.ajuda) MEM = { n: nBase, e: eBase };
    return resp;
  }
  function rotear(original, n, e) {
    // 1) O que o usuário citou do painel: números exibidos ("esses 4.550 veículos") e nomes de cards
    var nums = resolverNumeros(original, n, cenarioPainel());
    var card = achaCartao(n);
    var prefacio = '';
    if (nums.length) {
      var it = nums[0].item;
      prefacio = '<p class="agente__mini">O número <b>' + esc(nums[0].texto) + '</b> corresponde a <b>' + esc(it.rotulo) + '</b> (visão ' + NOME_CEN[it.cen] + ')' +
        (it.card && !card ? ' — card “' + esc((CARTOES.filter(function (c) { return c.id === it.card; })[0] || {}).titulo || '') + '”' : '') + '.</p>';
      var f = it.force || {};
      if (f.entregue) e.entregue = true;
      if (f.veic && !e.veic) e.veic = f.veic;
      if (f.cat && !e.cat) e.cat = f.cat;
      if (f.cat === 'selecionada') { e.selecionada = true; }
      if (it.cen !== 'consolidado' && !e.frente) e.frente = frenteDoCenario(it.cen);
      if (!card) card = CARTOES.filter(function (c) { return c.id === it.card; })[0] || null;
      if (f.meta) card = CARTOES.filter(function (c) { return c.id === 'metaSelecionados'; })[0];
    }
    if (card) {
      if (card.id === 'metaEntregas') e.entregue = true;
      if (card.id === 'veiculosContratados' && !e.cat) e.cat = 'contratada';
      if (card.id === 'contratadas' && !e.cat) e.cat = 'contratada';
      if (card.id === 'selecionadas' && !e.cat) { e.cat = 'selecionada'; e.selecionada = true; }
    }
    var citou = !!(card || nums.length);
    // O nome do card ("Meta Quantidade de Veículos Entregues") não conta como intenção da pergunta
    var nCompleto = n;
    if (card && card._chave) n = (' ' + n + ' ').replace(' ' + card._chave + ' ', ' ').replace(/\s+/g, ' ').trim();
    var r = rotear2(original, n, e, card, citou, nums, nCompleto);
    if (prefacio && r && r.html && !r.fatos.ajuda) r.html = prefacio + r.html;
    return r;
  }
  function rotear2(original, n, e, card, citou, nums, nCompleto) {
    var superlativoMax = temAlgum(n, ['mais', 'maior', 'maiores', 'principal', 'principais', 'lidera', 'lider', 'top', 'ranking', 'primeiro', 'primeiros', 'concentra', 'concentram']);
    var superlativoMin = temAlgum(n, ['menos', 'menor', 'menores', 'ultimo', 'ultimos', 'pior']);
    var dim = dimensaoDaPergunta(n);
    var metrica = metricaDaPergunta(n, e, original);

    // Pergunta sobre o próprio card ("o que mostra...", "como é calculado...")
    if (card && /\bo que (e|mostra|representa|significa|ha)\b|\bcomo (e|foi|sao) (calculad|feit|obtid)\w*|\bcomo calcula\w*|\bexplique\b|\bde onde vem\b|\bqual a regra\b|\bdescreva\b|\bpara que serve\b/.test(n) && !/\bvalor\b.*\brepresenta|\bquanto\b/.test(n)) {
      return respostaCartao(card, cenarioEscolhido(e, true));
    }
    var sobra = n.split(' ').filter(function (w) { return w && ['o', 'a', 'os', 'as', 'do', 'da', 'de', 'dos', 'das', 'card', 'cards', 'painel', 'grafico', 'indicador', 'quadro', 'no', 'na', 'sobre', 'me', 'fale', 'mostre', 'veja'].indexOf(w) < 0; });
    if (card && !sobra.length && !nums.length) return respostaCartao(card, cenarioEscolhido(e, true));

    // Valor/quantidade de desistências (status do painel)
    if (/\bdesistenc\w*/.test(n) && /\b(valor|quanto|quantos|quantas|total|somam|investimento|apoio)\b/.test(n) && !/\bo que\b/.test(n)) {
      var Pd = painel('consolidado');
      if (Pd) { var ad = Pd.proj.status.aCancelar;
        return { html: '<p>Hoje há <b>' + plural(ad.qtd, 'proposta', 'propostas') + '</b> em desistência (a cancelar), com <b>' + int(ad.veiculos) + '</b> veículos e <b>' + moeda(ad.valor) + '</b> de apoio previsto (Novo PAC). Esse valor sai da carteira selecionada assim que o cancelamento for formalizado.</p>',
                 fatos: { valor: ad.valor, propostas: ad.qtd, veiculos: ad.veiculos }, acoes: [], sugestoes: ['O que é a carteira a cancelar?', 'Qual o valor das propostas canceladas?', 'Qual a diferença entre proposta selecionada e contratada?'] }; }
    }
    // Diferença entre selecionada e contratada
    if (/\bdiferenca\b|\bdiferem\b/.test(n) && /\bselecionad\w*\b/.test(n) && /\bcontratad\w*\b/.test(n) && !nums.length) {
      var Ps = painel('consolidado');
      if (Ps) { var st = Ps.proj.status;
        return { html: '<p><b>Selecionada</b> é a proposta aprovada na carteira do programa; <b>contratada</b> é a que já virou contrato assinado. Toda contratada é selecionada, mas nem toda selecionada está contratada.</p><p>No Consolidado hoje: <b>' + int(st.contratados.propostas || st.contratados.qtd) + '</b> contratadas, <b>' + int(st.emPreparacao.qtd) + '</b> em preparação (a contratar), <b>' + int(st.aCancelar.qtd) + '</b> a cancelar (desistências) e <b>' + int(st.cancelados.qtd) + '</b> canceladas — as quatro formam a carteira selecionada. Em valor, as selecionadas usam o apoio previsto (Novo PAC) e as contratadas o valor do contrato.</p>',
                 fatos: { ajuda: 'diferenca-sel-contr' }, acoes: [], sugestoes: ['Quantas propostas estão em preparação?', 'Qual o valor das desistências?', 'Qual o valor contratado total?'] }; }
    }
    // Diferença entre dois números digitados ("diferença entre 5.000 e 4.550")
    var dn = /diferen[cç]a entre ([\d.,]+) e ([\d.,]+)/i.exec(original.replace(/(\d)\.(\d{3})/g, '$1$2'));
    if (dn) { var x = parseFloat(dn[1].replace(',', '.')), y = parseFloat(dn[2].replace(',', '.'));
      if (isFinite(x) && isFinite(y)) return { html: '<p>A diferença entre ' + int(x) + ' e ' + int(y) + ' é <b>' + int(Math.abs(x - y)) + '</b>' + ((x === 5000 || y === 5000) && Math.abs(x - y) < 5000 ? ' (a meta de entregas é 5.000: esse é o quanto falta ou excede)' : '') + '.</p>', fatos: { valor: Math.abs(x - y) }, acoes: [], sugestoes: SUGESTOES_BASE }; }
    // Diferença entre contratados e entregues = saldo a entregar
    if (/\bdiferenca\b/.test(n) && /\bcontratad\w*\b/.test(n) && /\bentregue\w*\b/.test(n)) { e.entregue = true; n = n + ' faltam ser entregues'; }
    // Dados que a base não registra
    var ind = temaIndisponivel(n); if (ind) return respostaIndisponivel(ind);
    // Diferença entre dois números citados do painel
    if (nums.length >= 2 && /\bdiferenca\b|\bdiferem\b|\bpara\b.*\bfaltam?\b|\bentre\b/.test(n)) return respostaDiferencaNumeros(nums);
    // Por que os cenários não fecham entre si
    if (/\b(consolidado)\b/.test(n) && /\b(publico)\b/.test(n) && /\b(privado)\b/.test(n) && /\b(soma|somam|fecha\w*|bate\w*|batem|confere\w*|diverg\w*|diferenca|inconsist\w*|igual|iguais)\b/.test(n)) { var rc = respostaReconciliacao(); if (rc) return rc; }
    if (/\b(soma|somando|somar)\b.*\b(publico)\b.*\b(privado)\b|\bpor que\b.*\b(nao )?(fecha\w*|bate\w*|soma\w*)\b|\b(inconsistenc\w*|divergenc\w*)\b/.test(n)) { var rc2 = respostaReconciliacao(); if (rc2) return rc2; }
    // Entregas e meta de entregas (inclui "qual valor representam os veículos entregues")
    var rankingIntent = dim && (superlativoMax || superlativoMin || temAlgum(n, ['por', 'cada', 'ranking', 'distribuicao', 'divisao']) || temAlgum(n, ['qual', 'quais']));
    var pedeMeta = /\bmeta\b/.test(n);
    if (e.entregue && !(rankingIntent && !/\bmeta\b/.test(n)) && metrica !== 'taxaEntrega' && !/\bquant[oa]s? (estados?|municipios?|cidades?|proponentes?)\b/.test(n)) {
      return respostaEntregas(e, n, original, citou, card);
    }
    if (pedeMeta && (!dim || (card && /^meta/.test(card.id)))) return respostaMetas(e, n, citou);
    if (card && card.id === 'metaSelecionados') return respostaMeta();

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

  window.Agente = { limparContexto: function () { MEM = null; }, responder: responder, base: R, totais: totais, extrairEntidades: extrairEntidades, escopo: escopo };
  function iniciar() { montarUI(); autoConferir(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
