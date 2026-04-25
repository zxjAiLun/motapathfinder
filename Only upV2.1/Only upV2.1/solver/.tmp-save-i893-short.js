const path=require('path'), fs=require('fs');
const {loadProject}=require('./lib/project-loader');
const {StaticSimulator}=require('./lib/simulator');
const {FunctionBackedBattleResolver}=require('./lib/battle-resolver');
const {buildStateKey}=require('./lib/state-key');
const {getFloorOrder}=require('./lib/score');
const {buildRouteRecord, writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..'));
const sim=new StaticSimulator(project,{stopFloorId:'MT5', battleResolver:new FunctionBackedBattleResolver(project), autoPickupEnabled:true, autoBattleEnabled:true, enableFightToLevelUp:true, enableResourcePocket:false});
const base=sim.createInitialState({rank:'chaos'});
const record=JSON.parse(fs.readFileSync('routes/latest/continue-hp3779-mt5-best-progress.route.json','utf8'));
let start=base;
for(const d of record.decisions.slice(0,29)){const a=sim.enumerateActions(start).find(a=>a.summary===d.summary); if(!a) throw new Error('missing '+d.summary); start=sim.applyAction(start,a);}
const back=sim.enumerateActions(start).find(a=>a.summary==='changeFloor@MT3:6,12');
start=sim.applyAction(start,back);
const startRouteLen=(start.route||[]).length;
console.log('start after MT3 buff return', start.floorId, start.hero, 'routeLen', startRouteLen);
function hasGoal(s){return (s.hero.equipment||[]).includes('I893') || Number((s.inventory||{}).I893||0)>0 || ((s.floorStates.MT2&&s.floorStates.MT2.removed&&s.floorStates.MT2.removed.has&&s.floorStates.MT2.removed.has('6,9')));}
function score(s){const h=s.hero; const equip=(h.equipment||[]).includes('I893')?1:0; const inv=Number((s.inventory||{}).I893||0)>0?1:0; const loc=h.loc||{}; const dist=Math.abs((loc.x||0)-6)+Math.abs((loc.y||0)-9); return equip*1e9+inv*8e8+(s.floorId==='MT2'?100000:0)-dist*8000+h.hp+h.atk*1200+h.def*1100+h.mdef*30+h.lv*10000+h.exp*200;}
function allowed(a){ if(a.kind==='resourcePocket'||a.kind==='fightToLevelUp')return false; if(a.kind==='battle'&&a.floorId==='MT3')return false; return ['battle','changeFloor','pickup','openDoor','equip','event','useTool'].includes(a.kind); }
let frontier=[start], best=null; const seen=new Map();
for(let depth=0; depth<=4; depth++){
 const next=[];
 for(const s of frontier){
  if(hasGoal(s)){ if(!best||score(s)>score(best)){best=s; console.log('BEST depth',depth,{floor:s.floorId,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,equipment:s.hero.equipment,inv:s.inventory,tail:(s.route||[]).slice(startRouteLen)});} }
  if(depth===16) continue;
  const acts=sim.enumerateActions(s).filter(allowed).sort((a,b)=>{
    const da=Number((a.estimate||{}).damage||0), db=Number((b.estimate||{}).damage||0); const ea=Number((a.estimate||{}).exp||0), eb=Number((b.estimate||{}).exp||0);
    const va=(a.summary==='pickup:I893@MT2:6,9'?1e7:0)+(a.summary==='equip:I893'?2e7:0)+(a.kind==='changeFloor'?20000:0)+(a.kind==='pickup'?12000:0)+ea*900-da;
    const vb=(b.summary==='pickup:I893@MT2:6,9'?1e7:0)+(b.summary==='equip:I893'?2e7:0)+(b.kind==='changeFloor'?20000:0)+(b.kind==='pickup'?12000:0)+eb*900-db;
    return vb-va;
  }).slice(0,14);
  for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} if(getFloorOrder(ns.floorId)>3)continue; const key=buildStateKey(ns); const sc=score(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);} 
 }
 next.sort((a,b)=>score(b)-score(a)); frontier=next.slice(0,700); console.log('depth',depth,'frontier',frontier.length,'best',best&&best.hero.hp);
}
if(best){
 const out='routes/latest/continue-hp3779-i893.route.json';
 const rec=buildRouteRecord({project, simulator:sim, initialState:base, finalState:best, options:{projectRoot:path.resolve('..'), toFloor:'MT5', profile:'segment-i893', rank:'chaos', solver:'segment-search', metadata:{kind:'i893-from-hp3779', finalHero:{hp:best.hero.hp,atk:best.hero.atk,def:best.hero.def,mdef:best.hero.mdef,lv:best.hero.lv,exp:best.hero.exp}, equipment:best.hero.equipment}}});
 writeRouteFile(out,rec); console.log('WROTE',out,'decisions',rec.decisions.length,'final',rec.final.floorId,rec.final.snapshot.hero);
}else console.log('NO GOAL');
