#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auditoria do Agente de Dúvidas: gera centenas de perguntas, calcula a resposta
esperada DIRETO da planilha (sem passar por base_agente.js nem agente.js, usando
a mesma regra das fórmulas da aba 'Dados para Painel') e confere o que o agente
devolve ("fatos").

Uso:  python3 auditoria_agente.py <planilha.xlsx> <pasta do painel> [arquivo_html]
Requer: openpyxl, playwright (chromium em /opt/pw-browsers/chromium).
"""
import asyncio, json, sys, os, collections, unicodedata
import openpyxl
from playwright.async_api import async_playwright

PLAN, PASTA = sys.argv[1], sys.argv[2]
HTML = sys.argv[3] if len(sys.argv) > 3 else 'index.html'

NOME = {'AC':'Acre','AL':'Alagoas','AM':'Amazonas','AP':'Amapá','BA':'Bahia','CE':'Ceará','DF':'Distrito Federal',
 'ES':'Espírito Santo','GO':'Goiás','MA':'Maranhão','MG':'Minas Gerais','MS':'Mato Grosso do Sul','MT':'Mato Grosso',
 'PA':'Pará','PB':'Paraíba','PE':'Pernambuco','PI':'Piauí','PR':'Paraná','RJ':'Rio de Janeiro','RN':'Rio Grande do Norte',
 'RO':'Rondônia','RR':'Roraima','RS':'Rio Grande do Sul','SC':'Santa Catarina','SE':'Sergipe','SP':'São Paulo','TO':'Tocantins'}
REGIOES = ['Norte','Nordeste','Centro-Oeste','Sudeste','Sul']

ws = openpyxl.load_workbook(PLAN, data_only=True, read_only=True)['BASEDEDADOS']
rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]
def g(r, i): return r[i] or 0
def sit(r): return (r[18] or '').lower()
def contratada(r): return any(k in sit(r) for k in ('contrat','concl','andamento','licita'))
def selecionada(r): return 'habilit' not in sit(r)
def frente(r): return 'Privado' if 'privado' in (r[5] or '').lower() else 'Público'

# métrica -> (função por linha, em contratadas) / (função por linha, em selecionadas)
MET = {
  'el':  ('ônibus elétricos', lambda r: g(r,24), lambda r: g(r,34)),
  'e6':  ('ônibus Euro 6',    lambda r: g(r,25), lambda r: g(r,35)),
  'tr':  ('veículos sobre trilhos', lambda r: g(r,26), lambda r: g(r,36)),
  'veic':('veículos',         lambda r: g(r,23), lambda r: g(r,34)+g(r,35)+g(r,36)),
  'inv': ('investimento',     lambda r: g(r,21), lambda r: g(r,15)),
  'prop':('propostas',        lambda r: 1,       lambda r: 1),
}
FRASE_Q = {'el':'ônibus elétricos','e6':'ônibus Euro 6','tr':'veículos sobre trilhos','veic':'veículos','inv':'investimento','prop':'propostas'}
DIM = {'uf': lambda r: r[6], 'regiao': lambda r: r[7], 'ano': lambda r: str(int(r[30])) if r[30] else 'sem ano'}

def agrega(filtro, mkey, stage, dim=None):
    f = MET[mkey][1 if stage == 'c' else 2]
    pool = [r for r in rows if (contratada(r) if stage == 'c' else selecionada(r)) and filtro(r)]
    if dim is None: return sum(f(r) for r in pool)
    out = collections.defaultdict(float)
    for r in pool: out[DIM[dim](r)] += f(r)
    return {k: v for k, v in out.items() if v > 0}

casos = []   # (pergunta, tipo, esperado, extra)
VERBO = {'c': 'contratados', 's': 'selecionados'}
DIMTXT = {'uf': 'estado', 'regiao': 'região', 'ano': 'ano da portaria'}
for st in ('c', 's'):
    for m in ('el','e6','veic','inv','prop'):
        if st == 's' and m in ('tr',): continue
        for dim in ('uf','regiao','ano'):
            if dim == 'ano' and st == 'c' and False: continue
            exp = agrega(lambda r: True, m, st, dim)
            if not exp: continue
            if m == 'prop':
                q = f"Qual {DIMTXT[dim]} tem mais propostas {'contratadas' if st=='c' else 'selecionadas'}?"
            elif m == 'inv':
                q = f"Qual {DIMTXT[dim]} tem o maior investimento {VERBO[st]}?"
            else:
                q = f"Qual {DIMTXT[dim]} tem mais {FRASE_Q[m]} {VERBO[st]}?"
            casos.append((q, 'ranking', exp, None))
# totais por UF e região
for m in ('el','e6','veic','inv'):
    for uf in NOME:
        for st in ('c',):
            exp = agrega(lambda r, uf=uf: r[6] == uf, m, st)
            if m == 'inv': q = f"Quanto foi o investimento contratado em {NOME[uf]}?" if uf != 'PA' else "Quanto foi o investimento contratado no estado do Pará?"
            else: q = f"Quantos {FRASE_Q[m]} foram contratados em {NOME[uf]}?" if uf != 'PA' else f"Quantos {FRASE_Q[m]} foram contratados no estado do Pará?"
            casos.append((q, 'total', exp, m))
    for rg in REGIOES:
        exp = agrega(lambda r, rg=rg: r[7] == rg, m, 'c')
        art = {'Norte':'no Norte','Nordeste':'no Nordeste','Centro-Oeste':'no Centro-Oeste','Sudeste':'no Sudeste','Sul':'no Sul'}[rg]
        q = f"Quanto foi o investimento contratado {art}?" if m == 'inv' else f"Quantos {FRASE_Q[m]} foram contratados {art}?"
        casos.append((q, 'total', exp, m))
# por frente
for fr, nome in (('Público','Refrota Público'),('Privado','Refrota Privado')):
    for m in ('el','e6','veic','inv','prop'):
        exp = agrega(lambda r, fr=fr: frente(r) == fr, m, 'c')
        q = (f"Quanto foi o investimento contratado no {nome}?" if m == 'inv' else
             f"Quantas propostas contratadas no {nome}?" if m == 'prop' else
             f"Quantos {FRASE_Q[m]} foram contratados no {nome}?")
        casos.append((q, 'total', exp, m))
# ranking por UF dentro de uma frente
for fr, nome in (('Público','Refrota Público'),('Privado','Refrota Privado')):
    for m in ('el','e6','veic'):
        exp = agrega(lambda r, fr=fr: frente(r) == fr, m, 'c', 'uf')
        if exp: casos.append((f"Qual estado tem mais {FRASE_Q[m]} contratados no {nome}?", 'ranking', exp, None))
# estado x ano da portaria
for uf in ('SP','MG','BA','RS','PE'):
    for ano in (2024, 2025, 2026):
        exp = agrega(lambda r, uf=uf, ano=ano: r[6] == uf and r[30] == ano, 'veic', 'c')
        casos.append((f"Quantos veículos foram contratados em {NOME[uf]} com portaria de {ano}?", 'total', exp, 'veic'))
# cidades
cid = collections.defaultdict(float)
for r in rows:
    if contratada(r): cid[f"{(r[10] or '').split(',')[0].strip()} ({r[6]})"] += g(r,23)
casos.append(("Quais as cidades com mais veículos contratados?", 'ranking', {k:v for k,v in cid.items() if v>0}, None))
prop = collections.defaultdict(float)
for r in rows:
    if contratada(r): prop[r[8]] += g(r,23)
casos.append(("Quais proponentes contrataram mais veículos?", 'ranking', {k:v for k,v in prop.items() if v>0}, None))


# ---- Entregas, valor por tipo e metas ----
DADOS_JSON = json.load(open(os.path.join(PASTA, 'dados.json'), encoding='utf-8'))
def ent(r): return g(r, 27)
def share(r, k):   # fatia do tipo k (24 el, 25 e6, 26 tr) no contrato
    tot = g(r,24) + g(r,25) + g(r,26)
    return g(r, k) / tot if tot else 0
for uf in NOME:
    exp = sum(ent(r) for r in rows if contratada(r) and r[6] == uf)
    casos.append((f"Quantos veículos foram entregues em {NOME[uf]}?" if uf != 'PA' else "Quantos veículos foram entregues no estado do Pará?", 'total', exp, 'ent'))
for rg in REGIOES:
    exp = sum(ent(r) for r in rows if contratada(r) and r[7] == rg)
    casos.append((f"Quantos veículos foram entregues no {rg}?" if rg != 'Centro-Oeste' else "Quantos veículos foram entregues no Centro-Oeste?", 'total', exp, 'ent'))
# entregas no programa e por frente (números do card)
casos.append(("Quantos veículos foram entregues?", 'total', DADOS_JSON['consolidado']['veiculosEntregues']['eletricos'] + DADOS_JSON['consolidado']['veiculosEntregues']['euro6'] + DADOS_JSON['consolidado']['veiculosEntregues']['trilhos'], 'ent'))
for fr, ch in (('Público', 'publico'), ('Privado', 'privado')):
    v = DADOS_JSON[ch]['veiculosEntregues']
    casos.append((f"Quantos veículos foram entregues no Refrota {fr}?", 'total', v['eletricos'] + v['euro6'] + v['trilhos'], 'ent'))
# valor dos entregues (proporcional ao contrato)
casos.append(("Qual valor representa os veículos entregues?", 'total', sum(g(r,21) * min(ent(r) / g(r,23), 1) for r in rows if contratada(r) and ent(r) > 0 and g(r,23)), 'val'))
casos.append(("Qual valor representa os 4.550 veículos entregues no card Meta Quantidade de Veículos Entregues?", 'total', sum(g(r,21) * min(ent(r) / g(r,23), 1) for r in rows if contratada(r) and ent(r) > 0 and g(r,23)), 'val'))
for uf in ('SP','MG','RJ','BA','PE'):
    casos.append((f"Qual valor representam os veículos entregues em {NOME[uf]}?", 'total', sum(g(r,21) * min(ent(r) / g(r,23), 1) for r in rows if contratada(r) and r[6] == uf and ent(r) > 0 and g(r,23)), 'val'))
# valor por tipo de veículo
for k, nome in ((24, 'ônibus elétricos'), (25, 'ônibus Euro 6')):
    casos.append((f"Quanto foi investido em {nome}?", 'total', sum(g(r,21) * share(r,k) for r in rows if contratada(r)), 'inv'))
    for rg in REGIOES:
        art = {'Norte':'no Norte','Nordeste':'no Nordeste','Centro-Oeste':'no Centro-Oeste','Sudeste':'no Sudeste','Sul':'no Sul'}[rg]
        casos.append((f"Quanto foi investido em {nome} {art}?", 'total', sum(g(r,21) * share(r,k) for r in rows if contratada(r) and r[7] == rg), 'inv'))
# metas
casos.append(("Quanto falta para a meta de veículos entregues?", 'meta', 5000 - (DADOS_JSON['consolidado']['veiculosEntregues']['eletricos'] + DADOS_JSON['consolidado']['veiculosEntregues']['euro6'] + DADOS_JSON['consolidado']['veiculosEntregues']['trilhos']), 'faltam'))
casos.append(("Como está a meta de veículos selecionados em 2026?", 'meta', DADOS_JSON['consolidado']['meta2026']['realizado'], 'realizado'))

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium'); pg = await b.new_page()
        await pg.add_init_script("window.Chart=function(){this.destroy=()=>{};this.update=()=>{}};window.Chart.register=()=>{};")
        await pg.goto('file://' + os.path.abspath(os.path.join(PASTA, HTML))); await pg.wait_for_timeout(800)
        falhas = 0
        res = await pg.evaluate("(qs)=>qs.map(q=>{try{const r=Agente.responder(q);return {f:r.fatos}}catch(e){return {erro:String(e)}}})", [c[0] for c in casos])
        for (q, tipo, exp, m), r in zip(casos, res):
            ok, got = False, None
            if 'erro' in r: got = r['erro']
            elif tipo == 'meta':
                got = r['f'].get(m)
                ok = got is not None and abs(got - exp) < 0.5
            elif tipo == 'ranking':
                itens = {k: v for k, v in (r['f'].get('itens') or []) if v > 0}
                got = itens
                ok = (set(itens) == set(exp)) and all(abs(itens[k] - exp[k]) < 0.01 for k in exp)
            else:
                got = r['f'].get('valor')
                ok = got is not None and abs(got - exp) < 0.01
            if not ok:
                falhas += 1
                print('FALHA:', q, '\n   esperado:', (list(exp.items())[:4] if isinstance(exp, dict) else exp), '\n   obtido  :', (list(got.items())[:4] if isinstance(got, dict) else got))
        print(f'\n{len(casos)} perguntas auditadas · {len(casos)-falhas} corretas · {falhas} falhas')
        await b.close(); sys.exit(1 if falhas else 0)
asyncio.run(main())
