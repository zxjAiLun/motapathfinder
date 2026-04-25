const path=require('path'),fs=require('fs');
const {loadProject}=require('./lib/project-loader'); const {StaticSimulator}=require('./lib/simulator'); const {FunctionBackedBattleResolver}=require('./lib/battle-resolver'); const {buildStateKey}=require('./lib/state-key'); const {getFloorOrder}=require('./lib/score'); const {buildRouteRecord,writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..'));
const sim=new StaticSimulator(project,{stopFloorId:'MT5',battleResolver:new FunctionBackedBattleResolver(project),autoPickupEnabled:true,autoBattleEnabled:true,enableFightToLevelUp:true,enableResourcePocket:false});
const base=sim.createInitialState({rank:'chaos'});
const startRecord=JSON.parse(fs.readFileSync('routes/latest/mt2-before-2608-hp3779.route.json','utf8'));
let start=base;
for(const d of startRecord.decisions){const a=sim.enumerateActions(start).find(x=>x.summary===d.summary); if(!a)throw new Error('start missing '+d.index+' '+d.summary); start=sim.applyAction(start,a);}
const startLen=(start.route||[]).length;
console.log('start hp3779',start.floorId,start.hero,'routeLen',startLen);
function goal(s){return (s.hero.equipment||[]).includes('I893');}
function hasI893(s){return goal(s)||Number((s.inventory||{}).I893||0)>0;}
function score(s){const h=s.hero, loc=h.loc||{}; const floor=getFloorOrder(s.floorId); const dist=s.floorId==='MT2'?Math.abs((loc.x||0)-6)+Math.abs((loc.y||0)-9):8; return (goal(s)?1e11:0)+(hasI893(s)?5e10:0)+floor*2e6-dist*70000+h.hp*8+h.atk*7000+h.def*6500+h.mdef*70+h.lv*180000+h.exp*4500;}
function allowed(a){
 if(a.kind==='resourcePocket'||a.kind==='fightToLevelUp')return false;
 if(a.kind==='battle'&&a.floorId==='MT3'){
   // allow only bottom/foundation fights before I893; no upper hard-route before the skill book
   const y=a.target&&a.target.y;
   if(y<10) return false;
 }
 return ['battle','changeFloor','pickup','openDoor','equip','event','useTool'].includes(a.kind);
}
function actionValue(a){const d=Number((a.estimate||{}).damage||0), e=Number((a.estimate||{}).exp||0); return (a.summary==='equip:I893'?1e10:0)+(a.summary==='pickup:I893@MT2:6,9'?5e9:0)+(a.kind==='pickup'?3e7:0)+(a.kind==='changeFloor'?1e7:0)+e*800000-d*45;}
let frontier=[start], best=null; const seen=new Map();
for(let depth=0; depth<=18; depth++){
 const next=[];
 for(const s of frontier){
   if(goal(s) && (!best || s.hero.hp>best.hero.hp || (s.hero.hp===best.hero.hp&&score(s)>score(best)))){
     best=s;
     console.log('BEST goal depth',depth,{floor:s.floorId,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,tail:(s.route||[]).slice(startLen)});
   }
   if(depth===18)continue;
   const acts=sim.enumerateActions(s).filter(allowed).sort((a,b)=>actionValue(b)-actionValue(a)).slice(0,18);
   for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} if(getFloorOrder(ns.floorId)>3)continue; const key=buildStateKey(ns); const sc=score(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);}
 }
 next.sort((a,b)=>score(b)-score(a)); frontier=next.slice(0,1000); console.log('depth',depth,'frontier',frontier.length,'seen',seen.size,'bestHp',best&&best.hero.hp);
}
if(best){const out='routes/latest/branch-hp3779-i893-best.route.json'; const rec=buildRouteRecord({project,simulator:sim,initialState:base,finalState:best,options:{projectRoot:path.resolve('..'),toFloor:'MT5',profile:'branch-hp3779-i893',rank:'chaos',solver:'branch-search',metadata:{kind:'branch-hp3779-i893',finalHero:{hp:best.hero.hp,atk:best.hero.atk,def:best.hero.def,mdef:best.hero.mdef,lv:best.hero.lv,exp:best.hero.exp},equipment:best.hero.equipment}}}); writeRouteFile(out,rec); console.log('WROTE',out,'decisions',rec.decisions.length,'final',rec.final.floorId,rec.final.snapshot.hero);} else console.log('NO GOAL');
