"use strict";

const DEFAULT_ROUTE_NAME = "onlyup-chaos-mt5-blueking";

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

const DEFAULT_ACTION_KINDS = [
  "battle",
  "pickup",
  "equip",
  "openDoor",
  "useTool",
  "changeFloor",
  "event",
];

const BASE_DP = {
  keyMode: "region",
  stopOnFirstGoal: false,
  maxActionsPerState: 9999,
  maxExpansions: 8000,
  maxRuntimeMs: 15000,
  goalSkylineLimit: 8,
};

function actionPolicy(overrides) {
  return {
    actionKinds: DEFAULT_ACTION_KINDS.slice(),
    forbidUnsupportedEvents: true,
    ...(overrides || {}),
  };
}

function dp(overrides) {
  return {
    ...BASE_DP,
    ...(overrides || {}),
  };
}

function onlyUpChaosMt5BluekingSpec(project) {
  const routeName = DEFAULT_ROUTE_NAME;
  const milestones = [
    {
      id: "mt1-gate-1559",
      label: "MT1 1559 生存门槛",
      goal: {
        type: "heroAtLeast",
        floorId: "MT1",
        minHero: { hp: 1559, atk: 19, def: 10, mdef: 130, exp: 5 },
        actionSurvivable: {
          summary: "battle:skeleton@MT1:8,1",
          exactDamage: 1558,
        },
      },
      actionPolicy: actionPolicy({ allowedFloors: ["MT1"] }),
      dp: dp({ maxExpansions: 4000 }),
    },
    {
      id: "mt2-entry",
      label: "进入 MT2",
      startFrom: "mt1-gate-1559",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 1601, atk: 21, def: 17, mdef: 130, exp: 6 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT1", "MT2"],
        allowChangeFloors: ["MT1:6,0"],
      }),
      dp: dp({ maxExpansions: 2500 }),
    },
    {
      id: "mt2-local-3582",
      label: "MT2 三怪顺序合流",
      startFrom: "mt2-entry",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 3582, atk: 31, def: 19, mdef: 250, exp: 9 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2"],
      }),
      dp: dp({
        keyMode: "mutation",
        safeReason: "MT2 local three-monster confluence has no movement damage and uses identical map mutation/resource state.",
        maxExpansions: 800,
      }),
    },
    {
      id: "mt2-hp3834",
      label: "MT2 四怪前 3834 基准",
      startFrom: "mt2-local-3582",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 3834, atk: 72, def: 35, mdef: 290 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT1", "MT2"],
        allowChangeFloors: ["MT2:6,0", "MT1:6,0"],
      }),
      dp: dp({
        keyMode: "mutation",
        safeReason: "Verified MT2/MT1 local return branch; mutation key is used only inside this bounded confluence segment.",
        maxExpansions: 1400,
      }),
    },
    {
      id: "mt2-left-chain-open",
      label: "MT2 左线资源链打开",
      startFrom: "mt2-hp3834",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 8372, atk: 87, def: 50, mdef: 440, exp: 7 },
        removedTiles: [
          { floorId: "MT2", x: 2, y: 8 },
          { floorId: "MT2", x: 3, y: 10 },
          { floorId: "MT2", x: 4, y: 11 },
        ],
        presentTiles: [
          { floorId: "MT2", x: 4, y: 7 },
          { floorId: "MT2", x: 8, y: 7 },
          { floorId: "MT2", x: 10, y: 8 },
          { floorId: "MT2", x: 8, y: 11 },
          { floorId: "MT2", x: 9, y: 10 },
          { floorId: "MT2", x: 10, y: 11 },
          { floorId: "MT2", x: 9, y: 9 },
          { floorId: "MT2", x: 11, y: 11 },
          { floorId: "MT2", x: 6, y: 6 },
          { floorId: "MT2", x: 6, y: 8 },
          { floorId: "MT2", x: 6, y: 9 },
        ],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2"],
      }),
      dp: dp({ enablePreviewScore: false, stopOnFirstGoal: true, maxExpansions: 1200, maxRuntimeMs: 10000 }),
    },
    {
      id: "mt3-first-return",
      label: "MT3 首轮宝石后返回 MT2",
      startFrom: "mt2-left-chain-open",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 9172, atk: 97, def: 65, mdef: 440, exp: 11 },
        removedTiles: [
          { floorId: "MT2", x: 2, y: 8 },
          { floorId: "MT2", x: 3, y: 10 },
          { floorId: "MT2", x: 4, y: 11 },
          { floorId: "MT3", x: 5, y: 11 },
          { floorId: "MT3", x: 7, y: 11 },
        ],
        presentTiles: [
          { floorId: "MT2", x: 4, y: 7 },
          { floorId: "MT2", x: 8, y: 7 },
          { floorId: "MT2", x: 10, y: 8 },
          { floorId: "MT2", x: 11, y: 11 },
          { floorId: "MT2", x: 6, y: 6 },
          { floorId: "MT2", x: 6, y: 8 },
          { floorId: "MT2", x: 6, y: 9 },
        ],
        actionSurvivable: {
          summary: "battle:redWizard@MT2:11,11",
        },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2", "MT3"],
        allowChangeFloors: ["MT2:6,12", "MT3:6,12"],
      }),
      dp: dp({ enablePreviewScore: false, stopOnFirstGoal: true, maxExpansions: 600, maxRuntimeMs: 8000 }),
    },
    {
      id: "mt2-redwizard-shield",
      label: "MT2 右下护盾资源",
      startFrom: "mt3-first-return",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 1, atk: 97, def: 90, mdef: 490, exp: 19 },
        removedTiles: [
          { floorId: "MT2", x: 11, y: 11 },
        ],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2"],
      }),
      dp: dp({ enablePreviewScore: "required", stopOnFirstGoal: true, maxExpansions: 500, maxRuntimeMs: 6000 }),
    },
    {
      id: "mt2-i893-equipped",
      label: "MT2 装备 I893",
      startFrom: "mt2-redwizard-shield",
      goal: {
        type: "heroAtLeast",
        floorId: "MT2",
        minHero: { hp: 8425, atk: 107, def: 95, mdef: 490, exp: 26 },
        equipmentIncludes: ["I893"],
        removedTiles: [
          { floorId: "MT2", x: 11, y: 11 },
          { floorId: "MT2", x: 6, y: 6 },
          { floorId: "MT2", x: 6, y: 8 },
          { floorId: "MT2", x: 6, y: 9 },
        ],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2"],
      }),
      dp: dp({ enablePreviewScore: "required", stopOnFirstGoal: true, maxExpansions: 1400, maxRuntimeMs: 10000 }),
    },
    {
      id: "mt3-i893-hp8425",
      label: "MT3 I893 功法",
      startFrom: "mt2-i893-equipped",
      goal: {
        type: "heroAtLeast",
        floorId: "MT3",
        minHero: { hp: 8425, atk: 107, def: 100, mdef: 510, exp: 31 },
        equipmentIncludes: ["I893"],
        removedTiles: [
          { floorId: "MT2", x: 11, y: 11 },
          { floorId: "MT2", x: 6, y: 6 },
          { floorId: "MT2", x: 6, y: 8 },
          { floorId: "MT2", x: 6, y: 9 },
          { floorId: "MT3", x: 5, y: 11 },
          { floorId: "MT3", x: 7, y: 11 },
        ],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT2", "MT3"],
        allowChangeFloors: ["MT2:6,12", "MT3:6,12"],
      }),
      dp: dp({ enablePreviewScore: false, stopOnFirstGoal: true, maxExpansions: 600, maxRuntimeMs: 8000 }),
    },
    {
      id: "mt4-hp4459",
      label: "MT4 入口关键属性",
      startFrom: "mt3-i893-hp8425",
      goal: {
        type: "heroAtLeast",
        floorId: "MT4",
        minHero: { hp: 4459 },
        minEffectiveHero: { atk: 421, def: 318, mdef: 5012 },
        equipmentIncludes: ["I893"],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT3", "MT4"],
        allowChangeFloors: ["MT3:6,0", "MT4:6,0"],
      }),
      dp: dp({ maxExpansions: 7000 }),
    },
    {
      id: "mt5-early-gem-entry",
      label: "MT4/MT5 早上楼资源分支",
      startFrom: "mt4-hp4459",
      goal: {
        type: "heroAtLeast",
        floorId: "MT5",
        minHero: { hp: 44471, atk: 777, def: 745, mdef: 4910, exp: 77 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT3", "MT4", "MT5"],
        allowChangeFloors: ["MT4:6,0", "MT3:6,0", "MT4:6,12", "MT5:6,12"],
      }),
      dp: dp({ maxExpansions: 7000 }),
    },
    {
      id: "mt5-first-sweep",
      label: "MT5 第一轮资源扫荡",
      startFrom: "mt5-early-gem-entry",
      goal: {
        type: "heroAtLeast",
        floorId: "MT5",
        minHero: { hp: 136514, atk: 977, def: 795, mdef: 6110, exp: 221 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT4", "MT5"],
        allowChangeFloors: ["MT4:6,12", "MT5:6,12"],
      }),
      dp: dp({ maxExpansions: 7000 }),
    },
    {
      id: "mt5-third-gate",
      label: "MT5 第三门槛",
      startFrom: "mt5-first-sweep",
      goal: {
        type: "heroAtLeast",
        floorId: "MT5",
        minHero: { hp: 105138, atk: 1097, def: 965, mdef: 6310, exp: 367 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT4", "MT5"],
        allowChangeFloors: ["MT4:6,12", "MT5:6,12"],
      }),
      dp: dp({ maxExpansions: 7000 }),
    },
    {
      id: "mt5-i894-equipped",
      label: "MT5 装备 I894",
      startFrom: "mt5-third-gate",
      goal: {
        type: "heroAtLeast",
        floorId: "MT5",
        minHero: { hp: 14404 },
        minEffectiveHero: { atk: 2075, def: 2024, mdef: 13296 },
        equipmentIncludes: ["I894"],
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT5"],
        allowChangeFloors: ["MT5:6,12"],
      }),
      dp: dp({ maxExpansions: 6000 }),
    },
    {
      id: "mt5-before-blueking",
      label: "MT5 boss 前血量",
      startFrom: "mt5-i894-equipped",
      goal: {
        type: "heroAtLeast",
        floorId: "MT5",
        minHero: { hp: 1098112 },
        minEffectiveHero: { atk: 3147, def: 3096, mdef: 20816 },
        actionSurvivable: {
          summary: "battle:blueKing@MT5:6,7",
        },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT5"],
        allowChangeFloors: ["MT5:6,12"],
      }),
      dp: dp({ maxExpansions: 6000 }),
    },
    {
      id: "mt5-blueking-kill",
      label: "MT5 击破 blueKing（织光仙子）",
      startFrom: "mt5-before-blueking",
      goal: {
        type: "bossDefeated",
        floorId: "MT5",
        x: 6,
        y: 7,
        enemyId: "blueKing",
        minHero: { hp: 1, atk: 2167, def: 2135, mdef: 13010, lv: 8 },
        minEffectiveHero: { atk: 3467, def: 3416, mdef: 20816 },
      },
      actionPolicy: actionPolicy({
        allowedFloors: ["MT5"],
        actionKinds: ["battle", "pickup", "equip", "changeFloor"],
        allowChangeFloors: ["MT5:6,12", "MT5:6,0"],
      }),
      dp: dp({ maxExpansions: 4000 }),
    },
  ];
  return {
    routeName,
    projectTitle: project && project.data && project.data.firstData ? project.data.firstData.title : null,
    milestones,
  };
}

function getMilestoneSpec(project, routeName) {
  const name = routeName || DEFAULT_ROUTE_NAME;
  if (name !== DEFAULT_ROUTE_NAME) throw new Error(`Unknown milestone route: ${name}`);
  return cloneJson(onlyUpChaosMt5BluekingSpec(project));
}

function listMilestones(project, routeName) {
  return getMilestoneSpec(project, routeName).milestones;
}

function getMilestoneById(project, routeName, milestoneId) {
  return listMilestones(project, routeName).find((milestone) => milestone.id === milestoneId) || null;
}

module.exports = {
  DEFAULT_ROUTE_NAME,
  getMilestoneById,
  getMilestoneSpec,
  listMilestones,
};
