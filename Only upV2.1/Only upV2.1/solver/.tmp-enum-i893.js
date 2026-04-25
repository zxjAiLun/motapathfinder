const path=require('path'),fs=require('fs');
const {loadProject}=require('./lib/project-loader'); const {StaticSimulator}=require('./lib/simulator'); const {FunctionBackedBattleResolver}=require('./lib/battle-resolver'); const {buildStateKey}=require('./lib/state-key'); const {buildRouteRecord,writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..')); const sim=new StaticSimulator(project,{stopFloorId:'MT5',battleResolver:new FunctionBackedBattleResolver(project),autoPickupEnabled:true,autoBattleEnabled:true,enableFightToLevelUp:true,enableResourcePocket:false});
const base=sim.createInitialState({rank:'chaos'}); const startRecord=JSON.parse(fs.readFileSync('routes/latest/mt2-before-2608-hp3779.route.json','utf8'));
let start=base; for(const d of startRecord.decisions){const a=sim.enumerateActions(start).find(x=>x.summary===d.summary); start=sim.applyAction(start,a);} const startLen=start.route.length;
const allowedEnemies=new Set(['redPriest','bluePriest','slimeman','brownWizard','redWizard','yellowGateKeeper']);
const allowedFloors=new Set(['MT2','MT3']);
function goal(s){return (s.hero.equipment||[]).includes('I893');}
function allowed(a){
 if(a.kind==='equip') return a.summary==='equip:I893';
 if(a.kind==='changeFloor') return true;
 if(a.kind==='battle') return allowedFloors.has(a.floorId)&&allowedEnemies.has(a.enemyId);
 if(a.kind==='pickup') return true;
 return false;
}
function priority(a){const d=Number((a.estimate||{}).damage||0), e=Number((a.estimate||{}).exp||0); return (a.summary==='equip:I893'?1e9:0)+(a.summary==='pickup:I893@MT2:6,9'?8e8:0)+(a.kind==='changeFloor'?1e6:0)+(a.kind==='pickup'?1e6:0)+e*10000-d;}
function stateScore(s){const h=s.hero; return h.hp*20+h.atk*1000+h.def*1000+h.mdef*10+h.lv*20000+h.exp*2000+(goal(s)?1e10:0)+(Number((s.inventory||{}).I893||0)>0?1e9:0);}
let frontier=[start]; const seen=new Map(); let best=null; let expanded=0;
for(let depth=0; depth<14 && frontier.length; depth++){
 const next=[];
 for(const s of frontier){
  expanded++;
  if(goal(s)){ if(!best||s.hero.hp>best.hero.hp){best=s; console.log('BEST',depth,{hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,tail:s.route.slice(startLen)});} continue; }
  const acts=sim.enumerateActions(s).filter(allowed).sort((a,b)=>priority(b)-priority(a));
  for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} if(!allowedFloors.has(ns.floorId))continue; const key=buildStateKey(ns); const sc=stateScore(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);}
 }
 next.sort((a,b)=>stateScore(b)-stateScore(a)); frontier=next.slice(0,5000); console.log('depth',depth,'expanded',expanded,'next',frontier.length,'best',best&&best.hero.hp);
}
if(best){const out='routes/latest/branch-hp3779-i893-enum.route.json'; const rec=buildRouteRecord({project,simulator:sim,initialState:base,finalState:best,options:{projectRoot:path.resolve('..'),toFloor:'MT5',profile:'enum-i893',rank:'chaos',solver:'enum-search',metadata:{kind:'enum-i893',expanded,finalHero:{hp:best.hero.hp,atk:best.hero.atk,def:best.hero.def,mdef:best.hero.mdef,lv:best.hero.lv,exp:best.hero.exp}}}}); writeRouteFile(out,rec); console.log('WROTE',out,rec.final.snapshot.hero, 'decisions', rec.decisions.length);} else console.log('NO BEST');
