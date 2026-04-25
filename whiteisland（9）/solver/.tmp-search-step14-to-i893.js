const path=require('path'),fs=require('fs');
const {loadProject}=require('./lib/project-loader'); const {StaticSimulator}=require('./lib/simulator'); const {FunctionBackedBattleResolver}=require('./lib/battle-resolver'); const {buildStateKey}=require('./lib/state-key'); const {getFloorOrder}=require('./lib/score'); const {buildRouteRecord,writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..')); const sim=new StaticSimulator(project,{stopFloorId:'MT5',battleResolver:new FunctionBackedBattleResolver(project),autoPickupEnabled:true,autoBattleEnabled:true,enableFightToLevelUp:true,enableResourcePocket:false});
const base=sim.createInitialState({rank:'chaos'}); const src=JSON.parse(fs.readFileSync('routes/latest/stage-mt5-best.route.json','utf8'));
let start=base; for(const d of src.decisions.slice(0,14)){const a=sim.enumerateActions(start).find(x=>x.summary===d.summary); if(!a)throw new Error('prefix missing '+d.summary); start=sim.applyAction(start,a);}
const startLen=start.route.length; console.log('start after step14',start.floorId,start.hero,'routeLen',startLen);
function goal(s){return (s.hero.equipment||[]).includes('I893');}
function score(s){const h=s.hero, loc=h.loc||{}; const eq=goal(s)?1:0; const inv=Number((s.inventory||{}).I893||0)>0?1:0; const removedI893=s.floorStates&&s.floorStates.MT2&&s.floorStates.MT2.removed&&s.floorStates.MT2.removed.has&&s.floorStates.MT2.removed.has('6,9')?1:0; const distI893=s.floorId==='MT2'?Math.abs((loc.x||0)-6)+Math.abs((loc.y||0)-9):12; const floorBonus=getFloorOrder(s.floorId)*10000; return eq*1e10+inv*8e9+removedI893*6e9 - distI893*20000 + floorBonus + h.hp*4+h.atk*3000+h.def*2600+h.mdef*35+h.lv*50000+h.exp*1500;}
function allowed(a){ if(a.kind==='resourcePocket'||a.kind==='fightToLevelUp')return false; if(a.kind==='battle'&&a.floorId==='MT3'&&['darkKnight','redKnight','greenKing','yellowKing','blackKing'].includes(a.enemyId)) return false; return ['battle','changeFloor','pickup','openDoor','equip','event','useTool'].includes(a.kind); }
let frontier=[start], best=null; const seen=new Map();
for(let depth=0; depth<=22; depth++){
 const next=[];
 for(const s of frontier){ if(goal(s)){ if(!best||s.hero.hp>best.hero.hp || (s.hero.hp===best.hero.hp&&score(s)>score(best))){best=s; console.log('BEST goal depth',depth,{floor:s.floorId,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,tail:(s.route||[]).slice(startLen)});} }
  if(depth===22) continue;
  const acts=sim.enumerateActions(s).filter(allowed).sort((a,b)=>{
    const val=(x)=>{const d=Number((x.estimate||{}).damage||0), e=Number((x.estimate||{}).exp||0); return (x.summary==='equip:I893'?1e9:0)+(x.summary==='pickup:I893@MT2:6,9'?8e8:0)+(x.kind==='changeFloor'?4e6:0)+(x.kind==='pickup'?3e6:0)+e*300000-d*25;};
    return val(b)-val(a);
  }).slice(0,16);
  for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} if(getFloorOrder(ns.floorId)>3)continue; const key=buildStateKey(ns); const sc=score(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);} }
 next.sort((a,b)=>score(b)-score(a)); frontier=next.slice(0,1800); console.log('depth',depth,'frontier',frontier.length,'bestHp',best&&best.hero.hp);
}
if(best){const out='routes/latest/branch-step14-i893-best.route.json'; const rec=buildRouteRecord({project,simulator:sim,initialState:base,finalState:best,options:{projectRoot:path.resolve('..'),toFloor:'MT5',profile:'branch-step14-i893',rank:'chaos',solver:'branch-search',metadata:{kind:'branch-step14-i893',finalHero:{hp:best.hero.hp,atk:best.hero.atk,def:best.hero.def,mdef:best.hero.mdef,lv:best.hero.lv,exp:best.hero.exp}, equipment:best.hero.equipment}}}); writeRouteFile(out,rec); console.log('WROTE',out,'decisions',rec.decisions.length,'final',rec.final.floorId,rec.final.snapshot.hero);} else console.log('NO GOAL');
