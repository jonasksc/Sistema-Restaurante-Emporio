'use strict';
// Empório Cachoeira - edição local. Operações de negócio serializadas no servidor.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const { writeAtomic } = require('./safe-storage');
const { acquireInstanceLock } = require('./instance-lock');
const PORT = Number(process.env.PORT || 3000);
const BASE = process.env.EMPORIO_BASE || (process.pkg ? path.dirname(process.execPath) : __dirname);
const DIR = path.join(BASE, 'dados');
const DB_FILE = path.join(DIR, 'restaurante.db');
const BK = path.join(DIR, 'backups');
let HOST = process.env.EMPORIO_HOST || '127.0.0.1';
const INSTANCE_ID = crypto.createHash('sha256').update(path.resolve(DB_FILE).toLowerCase()).digest('hex');
fs.mkdirSync(BK, {recursive:true});
let db, SQL, lastBk = 0;
const sessions = new Map(), TTL = 30*60*1000;
// Bloqueio temporario por IP e conta: PINs de 4 digitos exigem limite de tentativas.
const loginAttempts = new Map();
const dayKey = (n=Date.now()) => {const d = new Date(n);return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
function caixaIntervalo(dia){const hora=Number(state().vh)||0;const ini=new Date(dia+'T00:00:00');ini.setHours(hora,0,0,0);const fim=new Date(ini);fim.setDate(fim.getDate()+1);return {from:ini.getTime(),to:fim.getTime()}}
const C = x => Math.round((Number(x)+Number.EPSILON)*100);
function guard(test,message){if(!test){const e=new Error(message);e.status=400;throw e}}
function rows(sql,args=[]){const st=db.prepare(sql);try{st.bind(args);const out=[];while(st.step())out.push(st.getAsObject());return out}finally{st.free()}}
function run(sql,args=[]){db.run(sql,args)}
function one(sql,args=[]){return rows(sql,args)[0]||null}
function cfg(k){return one('SELECT valor FROM config WHERE chave=?',[k])?.valor||null}
function saveConfig(k,v){if(v===null)run('DELETE FROM config WHERE chave=?',[k]);else run('INSERT INTO config(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor',[k,String(v)])}
function state(){const r=one("SELECT valor FROM estado WHERE chave='estado'");let x=r?JSON.parse(r.valor):{};if(!Array.isArray(x.menu))x.menu=[];if(!x.mesas||typeof x.mesas!=='object')x.mesas={};if(!Array.isArray(x.ml))x.ml=Array.from({length:12},(_,i)=>i+1);x.id=Number(x.id)||Math.max(0,...x.menu.map(p=>Number(p.id)||0))+1;x.cozinha=x.cozinha&&typeof x.cozinha==='object'?x.cozinha:{};x.clientesMesa=x.clientesMesa&&typeof x.clientesMesa==='object'?x.clientesMesa:{};x.rev=Number(x.rev)||0;return x}
function storeState(x){x.rev=(Number(x.rev)||0)+1;run("INSERT INTO estado(chave,valor) VALUES('estado',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor",[JSON.stringify(x)])}
function backupFile(buf,force=false){if(force||Date.now()-lastBk>5*60*1000){try{writeAtomic(path.join(BK,'restaurante-'+dayKey()+'.db'),buf);lastBk=Date.now();const all=fs.readdirSync(BK).filter(n=>/^restaurante-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort();while(all.length>45)fs.unlinkSync(path.join(BK,all.shift()))}catch(e){console.error('Backup local falhou:',e.message)}}}
function persist(){const b=Buffer.from(db.export());writeAtomic(DB_FILE,b);backupFile(b)}
function atomic(fn){const before=Buffer.from(db.export());run('BEGIN IMMEDIATE');try{const result=fn();run('COMMIT');try{persist()}catch(e){db.close();db=new SQL.Database(before);throw e}return result}catch(e){try{run('ROLLBACK')}catch(_e){}throw e}}
function audit(actor,action,info={}){run('INSERT INTO auditoria(t,usuario,acao,detalhes) VALUES(?,?,?,?)',[Date.now(),actor||'sistema',action,JSON.stringify(info)])}
function content(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))}
function requestBody(req){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',chunk=>{size+=chunk.length;if(size>7*1024*1024){const e=new Error('Requisição muito grande');e.status=413;reject(e);req.destroy()}else chunks.push(chunk)});req.on('end',()=>{try{resolve(chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{})}catch(e){e.status=400;reject(e)}});req.on('error',reject)})}
function local(req){const x=req.socket.remoteAddress||'';return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(x)}
function hash(pass){const salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(pass,salt,32).toString('hex')}
function verify(pass,h){try{const [salt,s]=h.split(':');return crypto.timingSafeEqual(crypto.scryptSync(pass,salt,32),Buffer.from(s,'hex'))}catch(e){return false}}
function authorized(req){if(!cfg('pin')&&local(req))return {name:'configuracao-inicial',role:'admin',bootstrap:true};const tok=String(req.headers['x-token']||'');const s=sessions.get(tok);if(!s||s.expires<Date.now()){sessions.delete(tok);return null}s.expires=Date.now()+TTL;return s}
const allows=(s,roles)=>s&&roles.includes(s.role);
function deny(res){return content(res,401,{erro:'Acesso protegido. Entre com a senha de administrador ou usuário.'})}
function requireAccess(req,res,roles=['admin','gerente','atendente']){const s=authorized(req);if(!s){deny(res);return null}if(!allows(s,roles)){content(res,403,{erro:'Seu perfil não permite esta operação.'});return null}return s}
function session(name,role){const t=crypto.randomBytes(32).toString('hex');sessions.set(t,{name,role,expires:Date.now()+TTL});return t}
function validText(x,max=100){return typeof x==='string'&&x.trim().length>0&&x.trim().length<=max}
function money(v){return Number.isFinite(Number(v))&&Number(v)>=0&&C(v)<=10000000000}
function positive(v){return Number.isFinite(Number(v))&&Number(v)>0&&Number(v)<=1000000}
function product(x,id){return x.menu.find(p=>Number(p.id)===Number(id))}
function tableItems(x,n){return x.mesas[String(n)]||[]}
function itemCost(x,p){if(Array.isArray(p.receita)&&p.receita.length){return p.receita.reduce((sum,r)=>{const ins=product(x,r.id);return sum+(Number(ins?.c)||0)*Number(r.q||0)},0)}return Number(p.c)||0}
function saleRows(de,ate,includeCanceled=false){const where=[],params=[];if(de!==null){where.push('COALESCE(v.pago_em,v.t)>=?');params.push(de)}if(ate!==null){where.push('COALESCE(v.pago_em,v.t)<?');params.push(ate)}if(!includeCanceled)where.push('v.cancelada=0');where.push("v.status_pagamento='pago'");const cond=where.length?' WHERE '+where.join(' AND '):'';const vv=rows('SELECT v.*, COALESCE(v.pago_em,v.t) AS recebimento_em FROM vendas v'+cond+' ORDER BY recebimento_em',params);const ids=vv.map(v=>v.id);if(!ids.length)return [];const its=rows('SELECT * FROM venda_itens WHERE venda_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id',ids);const pays=rows('SELECT venda_id,metodo,centavos FROM venda_pagamentos WHERE venda_id IN ('+ids.map(()=>'?').join(',')+')',ids);return vv.map(v=>({id:v.id,t:v.recebimento_em,criadoEm:v.t,pagoEm:v.recebimento_em,statusPagamento:'pago',mesa:v.mesa,cliente:v.cliente||'',pay:v.pagamento,total:v.total,rec:v.recebido, cancelada:!!v.cancelada,motivo:v.motivo_cancelamento||'',custo:its.filter(i=>i.venda_id===v.id).reduce((s,i)=>s+(i.custo_centavos||0),0)/100,it:its.filter(i=>i.venda_id===v.id).map(i=>({n:i.produto,id:i.produto_id,q:i.qtd,p:i.preco})),pagamentos:pays.filter(i=>i.venda_id===v.id).map(i=>({metodo:i.metodo,valor:i.centavos/100}))}))}
function cancelSale(id,reason,restore,actor){guard(validText(reason,240),'Informe o motivo do cancelamento.');return atomic(()=>{const v=one('SELECT * FROM vendas WHERE id=?',[id]);guard(v,'Venda não encontrada');guard(!v.cancelada,'Venda já está cancelada');let x=state();if(restore){const mov=rows('SELECT produto_id,quantidade FROM venda_estoque WHERE venda_id=?',[id]);if(!mov.length){const itens=rows('SELECT produto_id,qtd,produto FROM venda_itens WHERE venda_id=?',[id]);for(const it of itens){const p=product(x,it.produto_id)||x.menu.find(p=>p.n===it.produto);if(p&&p.s!==null&&p.s!==undefined)p.s=Number(p.s)+Number(it.qtd)}}else for(const m of mov){const p=product(x,m.produto_id);if(p&&p.s!==null&&p.s!==undefined)p.s=Number((Number(p.s)+Number(m.quantidade)).toFixed(3))}storeState(x)}run('UPDATE vendas SET cancelada=1,motivo_cancelamento=?,cancelado_em=?,cancelado_por=? WHERE id=?',[reason,Date.now(),actor,id]);audit(actor,'cancelar_venda',{id,motivo:reason,repor:!!restore});return {ok:true,estado:x}})}
// Contas a receber: não contam como caixa ou faturamento recebido até a quitação.
function pendingRows(){
 const vv=rows("SELECT * FROM vendas WHERE cancelada=0 AND status_pagamento='pendente' ORDER BY t,id");
 if(!vv.length)return [];
 const ids=vv.map(v=>v.id), its=rows('SELECT * FROM venda_itens WHERE venda_id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id',ids);
 return vv.map(v=>({id:v.id,t:v.t,mesa:v.mesa,cliente:v.cliente||'',total:v.total,status:'pendente',it:its.filter(i=>i.venda_id===v.id).map(i=>({n:i.produto,q:i.qtd,p:i.preco}))}));
}
function settlePending(id,b,actor){
 guard(Number.isSafeInteger(id)&&id>0,'Conta inválida');
 const metodo=String(b.metodo||'');
 guard(['Dinheiro','Pix','Cartão de crédito','Cartão de débito'].includes(metodo),'Selecione uma forma de pagamento válida.');
 return atomic(()=>{
  const v=one('SELECT * FROM vendas WHERE id=?',[id]);
  guard(v&&!v.cancelada,'Conta não encontrada ou cancelada.');
  guard(v.status_pagamento==='pendente','Esta conta já foi paga.');
  const total=C(v.total),recebido=b.recebido==null?null:Number(b.recebido);
  if(metodo==='Dinheiro'&&recebido!==null){guard(money(recebido)&&C(recebido)>=total,'Valor em dinheiro insuficiente.');}
  else guard(recebido===null,'Valor recebido só é usado para pagamento em dinheiro.');
  const t=Date.now();
  run("UPDATE vendas SET status_pagamento='pago', pago_em=?, pagamento=?, recebido=? WHERE id=? AND status_pagamento='pendente'",[t,metodo,recebido,id]);
  run('INSERT INTO venda_pagamentos(venda_id,metodo,centavos) VALUES(?,?,?)',[id,metodo,total]);
  const diaRecebimento=dayKey(t-(Number(state().vh)||0)*3600000);
  const fechamentoAntigo=one('SELECT dia FROM caixa_fechamentos WHERE dia=?',[diaRecebimento]);
  if(fechamentoAntigo){run('DELETE FROM caixa_fechamentos WHERE dia=?',[fechamentoAntigo.dia]);audit(actor,'reabrir_fechamento_por_recebimento',{dia:fechamentoAntigo.dia,venda:id})}
  const trocoCentavos=recebido===null?0:C(recebido)-total;
  audit(actor,'receber_conta_pendente',{id,cliente:v.cliente,metodo,valorCentavos:total,recebidoCentavos:recebido===null?null:C(recebido),trocoCentavos,pagoEm:t});
  return {ok:true,id,pagoEm:t,metodo,total:v.total,recebido,troco:trocoCentavos/100};
 });
}
function applyAction(b,actor,role){guard(b&&typeof b==='object','Operação inválida');const op=String(b.op||'');const writeRoles={produto_add:['admin','gerente'],produto_edit:['admin','gerente'],produto_remove:['admin','gerente'],estoque_entrada:['admin','gerente'],estoque_controlar:['admin','gerente'],estoque_descontrolar:['admin','gerente'],receita_set:['admin','gerente'],mesa_remove:['admin','gerente'],mesa_transferir:['admin','gerente','atendente'],mesa_dividir:['admin','gerente','atendente'],estado_config:['admin','gerente']};guard(!writeRoles[op]||writeRoles[op].includes(role),'Sem permissão para realizar esta ação');return atomic(()=>{
 const x=state(),n=Number(b.mesa),key=String(n),p=product(x,b.id);
 switch(op){
 case 'mesa_add':{const num=Math.max(0,...x.ml.map(Number))+1;guard(num<10000,'Limite de mesas');x.ml.push(num);break}
 case 'mesa_remove':{guard(x.ml.includes(n),'Mesa não encontrada');guard(!tableItems(x,n).length,'Mesa possui itens');x.ml=x.ml.filter(a=>Number(a)!==n);delete x.mesas[key];delete x.clientesMesa[key];break}
 case 'mesa_cliente':{guard(x.ml.includes(n),'Mesa não encontrada');guard(typeof b.cliente==='string'&&b.cliente.length<=100,'Nome do cliente inválido');const nome=b.cliente.trim();guard(!/[\x00-\x1f\x7f]/.test(nome),'Nome do cliente inválido');if(nome)x.clientesMesa[key]=nome;else delete x.clientesMesa[key];break}
 case 'mesa_item':{guard(x.ml.includes(n),'Mesa não encontrada');guard(p,'Produto não encontrado');const delta=Number(b.delta);guard(delta===1||delta===-1,'Quantidade inválida');const arr=tableItems(x,n),it=arr.find(i=>Number(i.id)===Number(b.id));if(delta===1){guard(p.s==null||Number(p.s)>=Number((it?.q||0)+1),'Estoque insuficiente para este pedido');if(it)it.q++;else arr.push({id:p.id,q:1});x.mesas[key]=arr}else{guard(it,'Item não encontrado');it.q--;if(it.q<=0)arr.splice(arr.indexOf(it),1);if(!arr.length)delete x.mesas[key]}x.cozinha[key]={status:'Pendente',updated:Date.now()};break}
 case 'mesa_clear':{delete x.mesas[key];delete x.cozinha[key];delete x.clientesMesa[key];break}
 case 'mesa_transferir':{const alvo=Number(b.alvo);guard(x.ml.includes(n)&&x.ml.includes(alvo)&&n!==alvo,'Selecione mesas distintas');guard(tableItems(x,n).length,'Mesa de origem vazia');guard(!tableItems(x,alvo).length&&!x.clientesMesa[String(alvo)],'A mesa de destino precisa estar livre');x.mesas[String(alvo)]=x.mesas[key];delete x.mesas[key];if(x.clientesMesa[key])x.clientesMesa[String(alvo)]=x.clientesMesa[key];else delete x.clientesMesa[String(alvo)];delete x.clientesMesa[key];x.cozinha[String(alvo)]=x.cozinha[key]||{status:'Pendente',updated:Date.now()};delete x.cozinha[key];break}
 case 'mesa_dividir':{const alvo=Number(b.alvo);guard(x.ml.includes(n)&&x.ml.includes(alvo)&&n!==alvo,'Mesas inválidas');guard(!tableItems(x,alvo).length&&!x.clientesMesa[String(alvo)],'Mesa de destino precisa estar livre');guard(Array.isArray(b.itens)&&b.itens.length>0,'Informe itens para dividir');const origem=tableItems(x,n),separados=[];const vistos=new Set();for(const m of b.itens){const id=Number(m.id),q=Number(m.q);guard(!vistos.has(id),'Item duplicado na divisão');vistos.add(id);const it=origem.find(i=>Number(i.id)===id);guard(it&&Number.isInteger(q)&&q>0&&q<=it.q,'Quantidade de divisão inválida');it.q-=q;separados.push({id,q})}x.mesas[String(alvo)]=separados;if(origem.some(i=>i.q>0))x.mesas[key]=origem.filter(i=>i.q>0);else delete x.mesas[key];x.cozinha[String(alvo)]={status:'Pendente',updated:Date.now()};if(!x.mesas[key]){delete x.cozinha[key];if(x.clientesMesa[key]){x.clientesMesa[String(alvo)]=x.clientesMesa[key];delete x.clientesMesa[key]}}break}
 case 'mesa_status':{guard(tableItems(x,n).length,'Mesa sem pedido');guard(['Pendente','Em preparo','Pronto','Entregue'].includes(b.status),'Status inválido');x.cozinha[key]={status:b.status,updated:Date.now()};break}
 case 'produto_add':{guard(validText(b.n),'Informe o produto');guard(money(b.p),'Preço inválido');guard(b.s==null||(Number.isFinite(Number(b.s))&&Number(b.s)>=0),'Estoque inválido');x.menu.push({id:x.id++,n:b.n.trim(),p:Number(b.p),s:b.s==null?null:Number(b.s),m:Math.max(0,Number(b.m)||0),c:Math.max(0,Number(b.c)||0)});break}
 case 'produto_edit':{guard(p,'Produto não encontrado');guard(['n','p','s','m','c'].includes(b.field),'Campo não permitido');if(b.field==='n'){guard(validText(b.value),'Nome inválido');p.n=b.value.trim()}else{guard(b.field==='s'&&b.value===null||money(b.value),'Valor inválido');p[b.field]=b.value===null?null:Number(b.value)}break}
 case 'produto_remove':{guard(p,'Produto não encontrado');guard(!Object.values(x.mesas).some(it=>it.some(i=>i.id===p.id)),'Produto utilizado em uma mesa');guard(!x.menu.some(a=>Array.isArray(a.receita)&&a.receita.some(r=>r.id===p.id)),'Produto faz parte de uma ficha técnica');x.menu=x.menu.filter(a=>a.id!==p.id);break}
 case 'estoque_entrada':{guard(p,'Produto não encontrado');guard(positive(b.q),'Quantidade inválida');p.s=Number(((Number(p.s)||0)+Number(b.q)).toFixed(3));audit(actor,'entrada_estoque',{produto:p.id,q:Number(b.q)});break}
 case 'estoque_controlar':{guard(p,'Produto não encontrado');p.s=0;break}
 case 'estoque_descontrolar':{guard(p,'Produto não encontrado');p.s=null;p.m=0;break}
 case 'receita_set':{guard(p,'Produto não encontrado');guard(Array.isArray(b.insumos)&&b.insumos.length<=30,'Ficha técnica inválida');for(const r of b.insumos){guard(product(x,r.id)&&Number(r.id)!==Number(p.id)&&positive(r.q),'Insumo inválido')}p.receita=b.insumos.map(r=>({id:Number(r.id),q:Number(r.q)}));break}
 case 'estado_config':{guard(Number.isInteger(Number(b.vh))&&Number(b.vh)>=0&&Number(b.vh)<=12,'Horário inválido');x.vh=Number(b.vh);break}
 default:guard(false,'Operação desconhecida')}
 storeState(x);audit(actor,op,{mesa:Number.isFinite(n)?n:undefined,produto:b.id||undefined});return {ok:true,estado:x}
 })}
function closeSale(b,actor){const key=String(b.chave||'');guard(/^[0-9a-z-]{8,90}$/i.test(key),'Identificador da operação inválido');const previous=one('SELECT venda_id FROM venda_chaves WHERE chave=?',[key]);if(previous)return {id:previous.venda_id,duplicada:true,estado:state()};const mesa=Number(b.mesa);guard(Number.isInteger(mesa),'Mesa inválida');return atomic(()=>{const x=state();guard(x.ml.includes(mesa),'Mesa não encontrada');const its=tableItems(x,mesa);guard(its.length>0,'Mesa está vazia');let total=0,custo=0,lines=[],mov=new Map();for(const i of its){const p=product(x,i.id);guard(p&&positive(i.q),'Pedido inválido');const unit=C(p.p);guard(unit>=0&&money(p.p),'Preço inválido');const qty=Number(i.q);total+=unit*qty;const ci=C(itemCost(x,p))*qty;custo+=ci;lines.push({p,id:p.id,n:p.n,q:qty,unit,cost:ci});const recipe=Array.isArray(p.receita)&&p.receita.length?p.receita:[{id:p.id,q:1}];for(const r of recipe){const ingredient=product(x,r.id);guard(ingredient,'Insumo de receita não encontrado');mov.set(ingredient.id,(mov.get(ingredient.id)||0)+Number(r.q)*qty)}}total=Math.round(total);guard(total>=0&&total<=10000000000,'Total inválido');for(const [id,q] of mov){const p=product(x,id);if(p.s!==null&&p.s!==undefined)guard(Number(p.s)+1e-8>=q,'Estoque insuficiente de '+p.n)}
 const pendente=b.pay==='Pagar depois';
 const clienteAtual=(x.clientesMesa[String(mesa)]||'').trim();
 if(pendente){guard(!!clienteAtual,'Informe o nome do cliente na mesa antes de marcar para pagar depois.');guard(!b.pagamentos||!b.pagamentos.length,'Conta pendente não pode registrar pagamento antecipado.');guard(b.rec==null,'Conta pendente não recebe dinheiro neste momento.');}
 let pays=pendente?[]:(Array.isArray(b.pagamentos)?b.pagamentos:[{metodo:String(b.pay||''),valor:total/100}]);
 if(!pendente){guard(pays.length===1,'Escolha somente uma forma de pagamento (Misto foi removido).');guard(['Dinheiro','Pix','Cartão de crédito','Cartão de débito'].includes(pays[0].metodo),'Forma de pagamento inválida');guard(money(pays[0].valor)&&C(pays[0].valor)===total,'Valor do pagamento inválido.');}
 let recebido=b.rec==null?null:Number(b.rec);
 if(recebido!==null){guard(!pendente&&pays[0].metodo==='Dinheiro'&&money(recebido),'Valor recebido inválido');guard(C(recebido)>=total,'Valor recebido em dinheiro insuficiente');}
 for(const [id,q] of mov){const p=product(x,id);if(p.s!==null&&p.s!==undefined)p.s=Number((Number(p.s)-q).toFixed(3))}
 const method=pendente?'Pagar depois':pays[0].metodo;const t=Date.now();const cliente=x.clientesMesa[String(mesa)]||'';run('INSERT INTO vendas(t,mesa,cliente,pagamento,total,recebido,custo_centavos,status_pagamento,pago_em) VALUES(?,?,?,?,?,?,?,?,?)',[t,String(mesa),cliente,method,total/100,recebido,custo,pendente?'pendente':'pago',pendente?null:t]);const id=one('SELECT last_insert_rowid() AS id').id;for(const i of lines)run('INSERT INTO venda_itens(venda_id,produto,qtd,preco,produto_id,custo_centavos) VALUES(?,?,?,?,?,?)',[id,i.n,i.q,i.unit/100,i.id,i.cost]);for(const [idProduto,q] of mov)run('INSERT INTO venda_estoque(venda_id,produto_id,quantidade) VALUES(?,?,?)',[id,idProduto,q]);for(const p of pays)run('INSERT INTO venda_pagamentos(venda_id,metodo,centavos) VALUES(?,?,?)',[id,p.metodo,C(p.valor)]);run('INSERT INTO venda_chaves(chave,venda_id) VALUES(?,?)',[key,id]);delete x.mesas[String(mesa)];delete x.cozinha[String(mesa)];delete x.clientesMesa[String(mesa)];storeState(x);audit(actor,pendente?'criar_conta_pendente':'fechar_venda',{id,mesa,cliente,totalCentavos:total});return {id,estado:x,pendente,venda:{id,t,mesa,cliente,pay:method,total:total/100,rec:recebido,it:lines.map(i=>({n:i.n,q:i.q,p:i.unit/100})),pagamentos:pays,custo:custo/100}}})}
const schema=`
CREATE TABLE IF NOT EXISTS estado(chave TEXT PRIMARY KEY,valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendas(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,mesa TEXT,pagamento TEXT,total REAL NOT NULL,recebido REAL,status_pagamento TEXT NOT NULL DEFAULT 'pago',pago_em INTEGER);
CREATE TABLE IF NOT EXISTS venda_itens(id INTEGER PRIMARY KEY AUTOINCREMENT,venda_id INTEGER NOT NULL,produto TEXT NOT NULL,qtd REAL NOT NULL,preco REAL NOT NULL);
CREATE TABLE IF NOT EXISTS config(chave TEXT PRIMARY KEY,valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usuarios(id INTEGER PRIMARY KEY AUTOINCREMENT,nome TEXT UNIQUE NOT NULL,segredo TEXT NOT NULL,papel TEXT NOT NULL,ativo INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS auditoria(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,usuario TEXT NOT NULL,acao TEXT NOT NULL,detalhes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS venda_estoque(id INTEGER PRIMARY KEY AUTOINCREMENT,venda_id INTEGER NOT NULL,produto_id INTEGER NOT NULL,quantidade REAL NOT NULL);
CREATE TABLE IF NOT EXISTS venda_chaves(chave TEXT PRIMARY KEY,venda_id INTEGER UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS venda_pagamentos(id INTEGER PRIMARY KEY AUTOINCREMENT,venda_id INTEGER NOT NULL,metodo TEXT NOT NULL,centavos INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS caixa_movimentos(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,tipo TEXT NOT NULL,centavos INTEGER NOT NULL,descricao TEXT,usuario TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS caixa_fechamentos(dia TEXT PRIMARY KEY,t INTEGER NOT NULL,inicial_centavos INTEGER NOT NULL,contado_centavos INTEGER NOT NULL,esperado_centavos INTEGER NOT NULL,diferenca_centavos INTEGER NOT NULL,usuario TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vendas_t ON vendas(t);
CREATE INDEX IF NOT EXISTS idx_itens_venda ON venda_itens(venda_id);
CREATE INDEX IF NOT EXISTS idx_audit_t ON auditoria(t);`;
function addColumn(table,column,type){if(!rows('PRAGMA table_info('+table+')').some(x=>x.name===column))run('ALTER TABLE '+table+' ADD COLUMN '+column+' '+type)}
const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.wasm':'application/wasm'};
async function handler(req,res){try{
 const url=new URL(req.url,'http://localhost');const p=url.pathname;const method=req.method;const origin=req.headers.origin;if(origin&& !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin))return content(res,403,{erro:'Origem não permitida'});
 if(p==='/api/saude'&&method==='GET')return content(res,200,{ok:true,aplicativo:'Emporio Cachoeira'});
 if(p==='/api/identidade'&&method==='GET'&&local(req))return content(res,200,{app:'emporio-cachoeira',identity:INSTANCE_ID,host:HOST});
 if(p==='/api/auth'&&method==='GET'){const s=authorized(req);return content(res,200,{pin:!!cfg('pin'),ok:!!s,role:s?.role||null,usuario:s?.name||null,bootstrap:!!s?.bootstrap})}
 if(p==='/api/auth/entrar'&&method==='POST'){
  const b=await requestBody(req);
  const usuario=typeof b.usuario==='string'?b.usuario.trim().toLowerCase():'';
  const ip=req.socket.remoteAddress||'desconhecido';
  const key=ip+'|'+(usuario||'administrador');
  const now=Date.now();
  // Limpa chaves antigas para nao acumular historico na memoria do servidor.
  if(loginAttempts.size>1000)for(const [k,a] of loginAttempts)if(a.until<now-3600000)loginAttempts.delete(k);
  const attempt=loginAttempts.get(key)||{failures:0,until:0};
  if(attempt.until>now)return content(res,429,{erro:'Muitas tentativas incorretas. Aguarde 2 minutos e tente novamente.'});
  const pin=String(b.pin||'');let user=null;
  if(!usuario&&cfg('pin')&&verify(pin,cfg('pin')))user={name:'Administrador',role:'admin'};
  else if(validText(usuario,80)){
   const found=one('SELECT * FROM usuarios WHERE nome=? AND ativo=1',[usuario]);
   // Senhas antigas permanecem aceitas para nao bloquear contas ja cadastradas.
   if(found&&verify(String(b.senha||''),found.segredo))user={name:found.nome,role:found.papel};
  }
  if(!cfg('pin')&&local(req))user={name:'configuracao-inicial',role:'admin'};
  if(!user){attempt.failures++;if(attempt.failures>=5){attempt.failures=0;attempt.until=now+120000;}loginAttempts.set(key,attempt);return content(res,401,{erro:'Usuario ou PIN incorreto.'})}
  loginAttempts.delete(key);return content(res,200,{token:session(user.name,user.role),role:user.role,usuario:user.name});
 }
 if(p==='/api/auth/sair'&&method==='POST'){sessions.delete(String(req.headers['x-token']||''));return content(res,200,{ok:true})}
 if(p==='/api/auth/definir'&&method==='POST'){const s=requireAccess(req,res,['admin']);if(!s)return;const b=await requestBody(req),novo=String(b.novo||'');guard(/^\d{4}$/.test(novo),'O PIN precisa ter exatamente 4 números.');if(s.bootstrap)guard(local(req),'Configure a senha no computador principal');atomic(()=>{saveConfig('pin',hash(novo));audit(s.name,'alterar_pin')});sessions.clear();return content(res,200,{token:session('Administrador','admin')})}
 if(p==='/api/usuarios'&&method==='GET'){const s=requireAccess(req,res,['admin']);if(!s)return;return content(res,200,rows('SELECT id,nome,papel,ativo FROM usuarios ORDER BY nome'))}
 if(p==='/api/usuarios'&&method==='POST'){const s=requireAccess(req,res,['admin']);if(!s)return;const b=await requestBody(req);guard(/^[a-z0-9._-]{3,35}$/i.test(String(b.nome||'')),'Usuário inválido');guard(typeof b.senha==='string'&&/^\d{4}$/.test(b.senha),'O PIN do funcionário precisa ter exatamente 4 números.');guard(['gerente','atendente'].includes(b.papel),'Perfil inválido');atomic(()=>{run('INSERT INTO usuarios(nome,segredo,papel) VALUES(?,?,?)',[String(b.nome).toLowerCase(),hash(String(b.senha)),b.papel]);audit(s.name,'criar_usuario',{usuario:b.nome,papel:b.papel})});return content(res,200,{ok:true})}
 if(p==='/api/usuarios/status'&&method==='POST'){const s=requireAccess(req,res,['admin']);if(!s)return;const b=await requestBody(req);const user=one('SELECT id,nome FROM usuarios WHERE id=?',[Number(b.id)]);guard(user,'Funcionário não encontrado');atomic(()=>{run('UPDATE usuarios SET ativo=? WHERE id=?',[b.ativo?1:0,Number(b.id)]);audit(s.name,'status_usuario',{id:b.id,ativo:b.ativo})});for(const [token,ss] of sessions)if(ss.name===user.nome)sessions.delete(token);return content(res,200,{ok:true})}
 // Exclui apenas contas de funcionarios; vendas e auditoria permanecem intactas.
 if(p==='/api/usuarios/excluir'&&method==='POST'){
  const s=requireAccess(req,res,['admin']);if(!s)return;
  const b=await requestBody(req),id=Number(b.id);
  guard(Number.isSafeInteger(id)&&id>0,'Identificador de funcionario invalido');
  const user=one('SELECT id,nome,papel FROM usuarios WHERE id=?',[id]);
  guard(user&&['gerente','atendente'].includes(user.papel),'Conta de funcionario nao encontrada');
  atomic(()=>{
   run('DELETE FROM usuarios WHERE id=?',[id]);
   audit(s.name,'excluir_usuario',{id:user.id,usuario:user.nome,papel:user.papel});
  });
  // Invalida todas as sessoes abertas desse funcionario, inclusive pelo Wi-Fi.
  for(const [token,ss] of sessions)if(ss.name===user.nome)sessions.delete(token);
  return content(res,200,{ok:true});
 }
 if(p==='/api/usuarios/senha'&&method==='POST'){const s=requireAccess(req,res,['admin']);if(!s)return;const b=await requestBody(req);const user=one('SELECT id,nome FROM usuarios WHERE id=?',[Number(b.id)]);guard(user,'Funcionário não encontrado');guard(typeof b.senha==='string'&&/^\d{4}$/.test(b.senha),'O novo PIN precisa ter exatamente 4 números.');atomic(()=>{run('UPDATE usuarios SET segredo=? WHERE id=?',[hash(b.senha),user.id]);audit(s.name,'alterar_senha_usuario',{id:user.id})});for(const [token,ss] of sessions)if(ss.name===user.nome)sessions.delete(token);return content(res,200,{ok:true})}
 if(p==='/api/estado'&&method==='GET'){const s=requireAccess(req,res);if(!s)return;return content(res,200,state())}
 // Escrita de estado legado bloqueada: todas as operações agora são atômicas no servidor.
 if(p==='/api/estado'&&method==='PUT')return content(res,410,{erro:'Atualização antiga desativada. Recarregue o sistema com Ctrl+F5.'});
 if(p==='/api/operacao'&&method==='POST'){const s=requireAccess(req,res);if(!s)return;const b=await requestBody(req);return content(res,200,applyAction(b,s.name,s.role))}
 if(p==='/api/vendas'&&method==='GET'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const num=k=>url.searchParams.has(k)&&Number.isFinite(Number(url.searchParams.get(k)))?Number(url.searchParams.get(k)):null;return content(res,200,saleRows(num('de'),num('ate'),url.searchParams.get('canceladas')==='1'))}
 if(p==='/api/pendencias'&&method==='GET'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;return content(res,200,pendingRows())}
 if(p==='/api/pendencias/receber'&&method==='POST'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const b=await requestBody(req);return content(res,200,settlePending(Number(b.id),b,s.name))}
 if(p==='/api/vendas'&&method==='POST'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const b=await requestBody(req);return content(res,200,closeSale(b,s.name))}
 let match=p.match(/^\/api\/vendas\/(\d+)\/cancelar$/);if(match&&method==='POST'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const b=await requestBody(req);return content(res,200,cancelSale(Number(match[1]),b.motivo,b.repor,s.name))}
 if(p==='/api/auditoria'&&method==='GET'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;return content(res,200,rows('SELECT id,t,usuario,acao,detalhes FROM auditoria ORDER BY id DESC LIMIT 200'))}
 if(p==='/api/caixa/dia'&&method==='GET'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const dia=url.searchParams.get('dia')||dayKey();guard(/^\d{4}-\d{2}-\d{2}$/.test(dia),'Dia inválido');return content(res,200,{movimentos:rows('SELECT * FROM caixa_movimentos WHERE t>=? AND t<? ORDER BY t',[caixaIntervalo(dia).from,caixaIntervalo(dia).to]),fechamento:one('SELECT * FROM caixa_fechamentos WHERE dia=?',[dia])})}
 if(p==='/api/caixa/movimento'&&method==='POST'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const b=await requestBody(req);guard(['suprimento','sangria','despesa'].includes(b.tipo),'Tipo inválido');guard(positive(b.valor)&&money(b.valor),'Valor inválido');atomic(()=>{run('INSERT INTO caixa_movimentos(t,tipo,centavos,descricao,usuario) VALUES(?,?,?,?,?)',[Date.now(),b.tipo,C(b.valor),String(b.descricao||'').slice(0,240),s.name]);audit(s.name,'movimento_caixa',{tipo:b.tipo,valor:b.valor})});return content(res,200,{ok:true})}
 if(p==='/api/caixa/fechar'&&method==='POST'){const s=requireAccess(req,res,['admin','gerente']);if(!s)return;const b=await requestBody(req);guard(/^\d{4}-\d{2}-\d{2}$/.test(b.dia||''),'Data inválida');guard(money(b.inicial)&&money(b.contado),'Valores inválidos');const {from,to}=caixaIntervalo(b.dia);const vendas=saleRows(from,to);const dinheiro=C(vendas.reduce((n,v)=>n+v.pagamentos.filter(p=>p.metodo==='Dinheiro').reduce((a,p)=>a+p.valor,0),0));const mov=rows('SELECT * FROM caixa_movimentos WHERE t>=? AND t<?',[from,to]);const novo=mov.reduce((sum,m)=>sum+(m.tipo==='suprimento'?1:-1)*m.centavos,0);const esperado=C(b.inicial)+dinheiro+novo;const dif=C(b.contado)-esperado;atomic(()=>{run('INSERT INTO caixa_fechamentos(dia,t,inicial_centavos,contado_centavos,esperado_centavos,diferenca_centavos,usuario) VALUES(?,?,?,?,?,?,?) ON CONFLICT(dia) DO UPDATE SET t=excluded.t,inicial_centavos=excluded.inicial_centavos,contado_centavos=excluded.contado_centavos,esperado_centavos=excluded.esperado_centavos,diferenca_centavos=excluded.diferenca_centavos,usuario=excluded.usuario',[b.dia,Date.now(),C(b.inicial),C(b.contado),esperado,dif,s.name]);audit(s.name,'fechamento_caixa',{dia:b.dia,dif})});return content(res,200,{esperado:esperado/100,diferenca:dif/100})}
 if(p==='/api/backup'&&method==='GET'){const s=requireAccess(req,res,['admin']);if(!s)return;res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="restaurante-'+dayKey()+'.db"','Cache-Control':'no-store'});return res.end(Buffer.from(db.export()))}
 if(p==='/api/backup/restaurar'&&method==='POST'){const s=requireAccess(req,res,['admin']);if(!s)return;guard(local(req),'Restauração permitida somente no computador principal');const b=await requestBody(req);guard(b.confirmar==='RESTAURAR','Confirmação necessária');const raw=Buffer.from(String(b.base64||''),'base64');guard(raw.length>0&&raw.length<5*1024*1024,'Arquivo inválido ou muito grande');let candidate;try{candidate=new SQL.Database(raw);const check=candidate.exec('PRAGMA integrity_check');guard(check[0]?.values?.[0]?.[0]==='ok','Banco de dados danificado');const must=['estado','vendas','config'];for(const t of must)guard(candidate.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='"+t+"'").length,'O arquivo não é um banco do Empório')}finally{candidate?.close()}const old=Buffer.from(db.export()),safe=path.join(BK,'antes-restauracao-'+Date.now()+'.db');writeAtomic(safe,old);writeAtomic(DB_FILE,raw);db.close();db=new SQL.Database(raw);ensureSchema();persist();sessions.clear();return content(res,200,{ok:true})}
 if(p.startsWith('/api/'))return content(res,404,{erro:'Função não encontrada'});
 const raiz=path.resolve(__dirname,'public');let pathname;try{pathname=decodeURIComponent(p)}catch(e){return content(res,400,{erro:'Caminho inválido'})}const target=path.resolve(raiz,'.'+(pathname==='/'?'/index.html':pathname));if(!(target===raiz||target.startsWith(raiz+path.sep))||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);return res.end('Não encontrado')}res.writeHead(200,{'Content-Type':type[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});return fs.createReadStream(target).pipe(res);
 }catch(e){console.error(e);return content(res,e.status|| (e.message?.includes('UNIQUE constraint')?409:500),{erro:e.status?e.message:'Falha ao processar operação: '+String(e.message||e)})}}
function ensureSchema(){db.run(schema);addColumn('vendas','recebido','REAL');addColumn('vendas','cliente','TEXT');addColumn('vendas','cancelada','INTEGER NOT NULL DEFAULT 0');addColumn('vendas','motivo_cancelamento','TEXT');addColumn('vendas','cancelado_em','INTEGER');addColumn('vendas','cancelado_por','TEXT');addColumn('vendas','custo_centavos','INTEGER NOT NULL DEFAULT 0');addColumn('vendas','status_pagamento',"TEXT NOT NULL DEFAULT 'pago'");addColumn('vendas','pago_em','INTEGER');addColumn('venda_itens','produto_id','INTEGER');addColumn('venda_itens','custo_centavos','INTEGER NOT NULL DEFAULT 0')}
async function start(){
 const release=acquireInstanceLock(DIR);
 process.once('exit', release);
 let server=null;
 try {
  SQL=await initSqlJs({wasmBinary:fs.readFileSync(path.join(__dirname,'lib','sql-wasm.wasm'))});
  db=fs.existsSync(DB_FILE)?new SQL.Database(fs.readFileSync(DB_FILE)):new SQL.Database();
  ensureSchema();
  persist();
  if(process.argv.includes('--resetar-senha')){
   backupFile(Buffer.from(db.export()),true);
   atomic(()=>{saveConfig('pin',null);audit('manutencao_local','recuperar_pin')});
   console.log('PIN recuperado. Reconfigure uma senha na próxima abertura.');
   release();return;
  }
  if(!cfg('pin')&&!['127.0.0.1','localhost','::1'].includes(HOST)){console.log('Primeiro acesso: configure o PIN de 4 numeros neste computador. Reinicie para liberar o Wi-Fi.');HOST='127.0.0.1';}
  server=http.createServer(handler);
  await new Promise((resolve,reject)=>{
   const onError=e=>{server.off('listening',onListening);reject(e)};
   const onListening=()=>{server.off('error',onError);resolve()};
   server.once('error',onError);
   server.once('listening',onListening);
   server.listen(PORT,HOST);
  });
  server.once('close',release);
  const shutdown=()=>{
   if(server.listening){
    server.close(()=>{release();process.exitCode=0});
    if(typeof server.closeAllConnections==='function')server.closeAllConnections();
   } else {release();process.exitCode=0}
  };
  process.once('SIGINT',shutdown);
  process.once('SIGTERM',shutdown);
  console.log('Empório Cachoeira: http://'+HOST+':'+PORT+' | Dados: '+DB_FILE);
  return server;
 } catch(e) {
  try{server?.close()}catch(_){}
  release();
  throw e;
 }
}
if(require.main===module)start().catch(e=>{console.error('ERRO AO INICIAR:',e.message);process.exitCode=1});module.exports={start,dayKey};
