const path=require('path'),fs=require('fs');
const {loadProject}=require('./lib/project-loader'); const {StaticSimulator}=require('./lib/simulator'); const {FunctionBackedBattleResolver}=require('./lib/battle-resolver'); const {buildStateKey}=require('./lib/state-key'); const {buildRouteRecord,writeRouteFile}=require('./lib/route-store');
const project=loadProject(path.resolve('..')); const sim=new StaticSimulator(project,{stopFloorId:'MT5',battleResolver:new FunctionBackedBattleResolver(project),autoPickupEnabled:true,autoBattleEnabled:true,enableFightToLevelUp:true,enableResourcePocket:false});
const base=sim.createInitialState({rank:'chaos'}); const rec=JSON.parse(fs.readFileSync('routes/latest/mt2-before-2608-hp3779.route.json','utf8')); let start=base; for(const d of rec.decisions){start=sim.applyAction(start,sim.enumerateActions(start).find(a=>a.summary===d.summary));}
const startLen=start.route.length;
const allowedSummaries=new Set([
 'battle:redPriest@MT2:4,7','battle:redPriest@MT2:8,7','battle:redPriest@MT2:10,8',
 'battle:bluePriest@MT2:2,8','battle:bluePriest@MT2:9,10',
 'battle:slimeman@MT2:8,11','battle:slimeman@MT2:4,11',
 'battle:brownWizard@MT2:6,6','battle:brownWizard@MT2:3,10',
 'battle:redWizard@MT2:11,11','battle:redWizard@MT2:1,11',
 'battle:yellowGateKeeper@MT2:6,8',
 'changeFloor@MT2:6,12','changeFloor@MT3:6,12','equip:I893'
]);
function goal(s){return (s.hero.equipment||[]).includes('I893');}
function valState(s){const h=s.hero; return (goal(s)?1e12:0)+(Number((s.inventory||{}).I893||0)>0?1e11:0)+h.hp*100+h.atk*5000+h.def*5000+h.mdef*50+h.lv*50000+h.exp*3000;}
function valAction(a){const d=Number((a.estimate||{}).damage||0), e=Number((a.estimate||{}).exp||0); return (a.summary==='equip:I893'?1e10:0)+(a.kind==='changeFloor'?2e7:0)+e*500000-d*50;}
let frontier=[start], best=null; const seen=new Map(); let expanded=0;
for(let depth=0; depth<=12; depth++){
 const next=[];
 for(const s of frontier){expanded++; if(goal(s)){if(!best||s.hero.hp>best.hero.hp){best=s; console.log('BEST',depth,{hp:s.hero.hp,atk:s.hero.atk,def:s.hero.def,mdef:s.hero.mdef,lv:s.hero.lv,exp:s.hero.exp,tail:s.route.slice(startLen)});} continue;}
  const acts=sim.enumerateActions(s).filter(a=>allowedSummaries.has(a.summary)).sort((a,b)=>valAction(b)-valAction(a));
  for(const a of acts){let ns; try{ns=sim.applyAction(s,a);}catch(e){continue;} const key=buildStateKey(ns); const sc=valState(ns); if((seen.get(key)||-Infinity)>=sc)continue; seen.set(key,sc); next.push(ns);}
 }
 next.sort((a,b)=>valState(b)-valState(a)); frontier=next.slice(0,3000); console.log('depth',depth,'expanded',expanded,'frontier',frontier.length,'best',best&&best.hero.hp);
}
if(best){const out='routes/latest/branch-hp3779-i893-focused.route.json'; const route=buildRouteRecord({project,simulator:sim,initialState:base,finalState:best,options:{projectRoot:path.resolve('..'),toFloor:'MT5',profile:'focused-i893',rank:'chaos',solver:'focused-enum',metadata:{kind:'focused-i893',expanded,finalHero:{hp:best.hero.hp,atk:best.hero.atk,def:best.hero.def,mdef:best.hero.mdef,lv:best.hero.lv,exp:best.hero.exp}}}}); writeRouteFile(out,route); console.log('WROTE',out,route.final.snapshot.hero,'decisions',route.decisions.length);} else console.log('NO BEST');
