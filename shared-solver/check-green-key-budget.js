"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const d=require("./lib/durable-search");
const {loadProject}=require("./lib/project-loader");
const {buildDpStateKey}=require("./lib/dp-search");
const {buildRouteRecord}=require("./lib/route-store");
const {buildStateKey}=require("./lib/state-key");
const {cloneState}=require("./lib/state");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"green-key-budget-"));
try {
 const projectDir=path.join(temp,"project");fs.mkdirSync(path.join(projectDir,"floors"),{recursive:true});
 const hero={hp:100,atk:1,def:0,lv:1,exp:0,loc:{x:0,y:0,direction:"right"}};
 for(const [name,object] of Object.entries({
  data:{main:{floorIds:["K"]},firstData:{floorId:"K",hero,levelUp:[]},flags:{},values:{}},
  maps:{88:{cls:"animates",id:"greenDoor",trigger:"openDoor",doorInfo:{keys:{greenKey:1}}},
    89:{cls:"animates",id:"tripleGreenDoor",trigger:"openDoor",doorInfo:{keys:{greenKey:3}}}},
  items:{},enemys:{},icons:{},functions:{},events:{commonEvent:{}}
 }))fs.writeFileSync(path.join(projectDir,`${name}.js`),`var ${name}_test = ${JSON.stringify(object)};`);
 const floor={floorId:"K",title:"K",width:4,height:1,map:[[0,88,88,89]],events:{},firstArrive:[],eachArrive:[],afterBattle:{},autoEvent:{},changeFloor:{}};
 fs.writeFileSync(path.join(projectDir,"floors/K.js"),`main.floors.K = ${JSON.stringify(floor)};`);
 const base={initial:{floorId:"K",hero,inventory:{greenKey:30},flags:{}},allowedFloors:["K"],protectedItems:["greenKey"],
  stages:[{floorId:"K"}],budgets:[{expansions:10,runtimeMs:1000}],candidateLimit:2,heapMb:256,maxRssMb:512};
 const cap={...base,protectedSpendLimits:{greenKey:1}};
 d.validateConfig(base);d.validateConfig(cap);
 for(const limits of [{greenKey:1.5},{greenKey:2},{greenKey:-1},{blueKey:1},{greenKey:1,blueKey:0}])
  assert.throws(()=>d.validateConfig({...base,protectedSpendLimits:limits}));
 assert.notEqual(d.problemFingerprint(base,temp),d.problemFingerprint(cap,temp));
 assert.notEqual(d.resumeSearchFingerprint(base,temp),d.resumeSearchFingerprint(cap,temp));
 assert.equal(d.searchSemantics(base).protectedSpendLimits,undefined);
 assert.equal(d.searchSemantics(cap).protectedSpendLimits.greenKey,1);
 assert(d.protectedCost({requirements:{greenKey:1}},base));
 const project=loadProject(temp),sim=d.makeSimulator(project,cap),state=d.initialState(project,sim,cap);
 assert.equal(d.spentGreenKey(state),0);assert(!Object.hasOwn(state.flags,d.GREEN_SPENT_FLAG));
 const actions=sim.enumeratePrimitiveActions(state).actions||[];
 const first=actions.find(a=>a.kind==="openDoor"&&a.target?.x===1);
 assert(first,"first green door must be available within cap");
 assert(!actions.some(a=>a.kind==="openDoor"&&a.target?.x===3),"three-key door forbidden");
 assert(!d.protectedCost(first,cap,state));
 const next=sim.applyAction(state,first);
 assert(next,"first green door must execute");
 assert.equal(d.spentGreenKey(next),1);assert.equal(next.inventory.greenKey,29);
 assert.equal(state.inventory.greenKey,30);assert(!Object.hasOwn(state.flags,d.GREEN_SPENT_FLAG),"input must remain unchanged");
 const later=sim.enumeratePrimitiveActions(next).actions||[];
 assert(!later.some(a=>a.kind==="openDoor"),"second green door must be unavailable");
 assert(d.protectedCost({requirements:{greenKey:1}},cap,next));
 assert(d.protectedCost({requirements:{greenKey:3}},cap,state));
 const afterPickup=cloneState(next);afterPickup.inventory.greenKey+=5;
 assert(d.protectedCost({requirements:{greenKey:1}},cap,afterPickup),"pickup must not reset lifetime spend");
 const sameStock=cloneState(next);delete sameStock.flags[d.GREEN_SPENT_FLAG];
 assert.notEqual(buildDpStateKey(sim,next,{dpKeyMode:"location"}),buildDpStateKey(sim,sameStock,{dpKeyMode:"location"}));
 assert.notEqual(buildStateKey(next),buildStateKey(sameStock));
 const untracked=cloneState(next);untracked.inventory.greenKey-=1;
 assert.throws(()=>d.assertProtected(next,untracked,cap),/unaccounted/);
 assert.throws(()=>d.assertProtected(next,{...next,flags:{...next.flags,[d.GREEN_SPENT_FLAG]:2}},cap),/budget/);
 assert.throws(()=>d.assertProtected(state,next,base),/decreased/);
 const record=buildRouteRecord({project,simulator:sim,initialState:state,finalState:next,actionEntries:[],
  options:{projectRoot:temp,solver:"green-key-budget-check",metadata:{maxSpendItems:{greenKey:1},zeroSpendItems:[]}}});
 assert(record.decisions.length>0,"strict route reconstruction must include the door");
 assert.equal(record.final.exactStateKey,buildStateKey(next));
 const zero=d.makeSimulator(project,base),zeroState=d.initialState(project,zero,base);
 assert(!zero.enumeratePrimitiveActions(zeroState).actions.some(a=>a.kind==="openDoor"));
 assert(!Object.hasOwn(zeroState.flags,d.GREEN_SPENT_FLAG));
 console.log("green-key budget contract PASS: default OFF, first door, second/triple blocked, pickup cannot reset, distinct DP/exact keys, strict route replay and unexplained spend guards");
} finally {fs.rmSync(temp,{recursive:true,force:true});}
