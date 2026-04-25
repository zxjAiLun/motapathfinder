const path=require('path'),fs=require('fs');
const {loadProject}=require('./lib/project-loader'); const {StaticSimulator}=require('./lib/simulator'); const {FunctionBackedBattleResolver}=require('./lib/battle-resolver'); const {buildStateKey}=require('./lib/state-key'); const {getFloorOrder}=require('./lib/score'); const {buildRouteRecord,writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..')); const sim=new StaticSimulator(project,{stopFloorId:'MT5',battleResolver:new FunctionBackedBattleResolver(project),autoPickupEnabled:true,autoBattleEnabled:true,enableFightToLevelUp:true,enableResourcePocket:false});
const startRecord=JSON.parse(fs.readFileSync('routes/latest/continue-i893-mt5-best.route.json','utf8')); let start=sim.createInitialState({rank:'chaos'});
for(const d of startRecord.decisions){const a=sim.enumerateActions(start).find(a=>a.summary===d.summary); if(!a)throw new Error('missing '+d.index+' '+d.summary); start=sim.applyAction(start,a);} 
const first=sim.enumerateActions(start).find(a=>a.summary==='battle:darkKnight@MT3:10,5'); if (first) start=sim.applyAction(start, first); const startLen=start.route.length; console.log('start',start.floorId,start.hero,'routeLen',startLen);
function isGoal(s){return getFloorOrder(s.floorId)>=4 || s.floorId==='MT4';}
function posScore(s){const h=s.hero, loc=h.loc||{}; const distUp=Math.abs((loc.x||0)-6)+Math.abs((loc.y||0)-0); return (getFloorOrder(s.floorId)*1e8) + (s.floorId==='MT3' ? -distUp*50000 : 0)+h.atk*3000+h.def*2600+h.mdef*40+h.lv*15000+h.exp*1000+h.hp;}
function allowed(a){ if(a.kind==='resourcePocket'||a.kind==='fightToLevelUp')return false; return ['battle','changeFloor','pickup','openDoor','equip','event','useTool'].includes(a.kind); }
let frontier=[start], best=start, goal=null; const seen=new Map();
for(let depth=0; depth<=24; depth++){
 const next=[];
 for(const s of frontier){ if(isGoal(s)){goal=s; break;} if(posScore(s)>posScore(best)){best=s; console.log('BEST',depth,{floor:s.floorId,hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,loc:s.hero.loc,tail:(s.route||[]).slice(startLen)});} if(depth===20)continue;
  const acts=sim.enumerateActions(s).filter(allowed).sort((a,b)=>{
   const da=Number((a.estimate||{}).damage||0), db=Number((b.estimate||{}).damage||0); const ea=Number((a.estimate||{}).exp||0), eb=Number((b.estimate||{}).exp||0);
   const ta=(a.kind==='changeFloor'?1e7:0)+(a.kind==='pickup'?5e6:0)+ea*200000-da*20 + ((a.target? - (Math.abs(a.target.x-6)+Math.abs(a.target.y-0))*1000:0));
   const tb=(b.kind==='changeFloor'?1e7:0)+(b.kind==='pickup'?5e6:0)+eb*200000-db*20 + ((b.target? - (Math.abs(b.target.x-6)+Math.abs(b.target.y-0))*1000:0));
   return tb-ta;
  }).slice(0,18);
  for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} if(getFloorOrder(ns.floorId)>4)continue; const key=buildStateKey(ns); const sc=posScore(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);} }
 if(goal)break; next.sort((a,b)=>posScore(b)-posScore(a)); frontier=next.slice(0,2000); console.log('depth',depth,'frontier',frontier.length,'best',best.floorId,best.hero.hp,best.hero.loc);
}
const chosen=goal||best; const kind=goal?'goal-mt4':'best-local'; console.log('chosen',kind,chosen.floorId,chosen.hero,(chosen.route||[]).slice(startLen));
const out=`routes/latest/continue-i893-${kind}.route.json`; const rec=buildRouteRecord({project,simulator:sim,initialState:sim.createInitialState({rank:'chaos'}),finalState:chosen,options:{projectRoot:path.resolve('..'),toFloor:'MT5',profile:'local-mt4',rank:'chaos',solver:'local-segment',metadata:{kind,from:'continue-i893-mt5-best.route.json',finalHero:{hp:chosen.hero.hp,atk:chosen.hero.atk,def:chosen.hero.def,mdef:chosen.hero.mdef,lv:chosen.hero.lv,exp:chosen.hero.exp}}}});
writeRouteFile(out,rec); console.log('WROTE',out,'decisions',rec.decisions.length,'final',rec.final.floorId,rec.final.snapshot.hero);
