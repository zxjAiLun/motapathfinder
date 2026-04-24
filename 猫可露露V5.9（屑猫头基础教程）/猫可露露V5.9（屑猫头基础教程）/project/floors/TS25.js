main.floors.TS25=
{
    "floorId": "TS25",
    "title": "琉璃虹彩 5层",
    "name": "琉璃虹彩 5层",
    "width": 13,
    "height": 13,
    "canFlyTo": true,
    "canFlyFrom": true,
    "canUseQuickShop": true,
    "cannotViewMap": false,
    "images": [],
    "ratio": 50,
    "defaultGround": 20000,
    "bgm": "6.mp3",
    "firstArrive": [],
    "eachArrive": [],
    "parallelDo": "",
    "events": {},
    "changeFloor": {
        "11,11": {
            "floorId": ":before",
            "stair": "upFloor"
        }
    },
    "beforeBattle": {},
    "afterBattle": {
        "6,2": [
            "Stage Clear！\n得到了\r[yellow]${status:hp}\r分数。\n已累计了\r[lime]${item:greenKey}\r绿钥匙。",
            {
                "type": "unloadEquip",
                "pos": 0
            },
            {
                "type": "insert",
                "name": "清空状态"
            },
            {
                "type": "setValue",
                "name": "status:exp",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "flag:allhp",
                "operator": "+=",
                "value": "status:hp"
            },
            {
                "type": "setValue",
                "name": "status:lv",
                "value": "flag:nowlevel"
            },
            {
                "type": "setValue",
                "name": "item:yellowKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:blueKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:redKey",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:pickaxe",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:centerFly",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I893",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I894",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I895",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "item:I897",
                "value": "0"
            },
            {
                "type": "setValue",
                "name": "status:hp",
                "value": "flag:allhp"
            },
            {
                "type": "setValue",
                "name": "status:atk",
                "value": "flag:nowatk"
            },
            {
                "type": "setValue",
                "name": "status:def",
                "value": "flag:nowdef"
            },
            {
                "type": "setValue",
                "name": "status:mdef",
                "value": "flag:nowmdef"
            },
            {
                "type": "setValue",
                "name": "status:lv",
                "value": "flag:nowlevel"
            },
            {
                "type": "setValue",
                "name": "status:exp",
                "value": "flag:nowexp"
            },
            {
                "type": "changeFloor",
                "floorId": "JC19",
                "loc": [
                    6,
                    0
                ],
                "direction": "down"
            }
        ]
    },
    "afterGetItem": {},
    "afterOpenDoor": {},
    "autoEvent": {},
    "cannotMove": {},
    "cannotMoveIn": {},
    "map": [
    [150,150,150,150,150,20291,20292,20293,150,150,150,150,150],
    [150,150,150,150,150,639,  0,641,150,150,150,150,150],
    [150,150,150,150,  0,  0,2152,  0,  0,150,150,150,150],
    [150,620,20120,20121,20122,642,  0,640,20120,20121,20122,620,150],
    [150,367,150,150,150,20254,371,20255,150,150,150,367,150],
    [150,619,150,150,150,150,638,150,150,150,150,619,150],
    [150,  0,150,150,150,  0,371,  0,150,150,150,  0,150],
    [150,  0,150,150,365,619,150,619,365,150,150,  0,150],
    [150,  0,150,150,  0,150,150,150,  0,150,150,  0,150],
    [150,360,150,150,369,635,  0,636,369,150,150,360,150],
    [150,  0,150,150,150,150,364,150,150,150,150,  0,150],
    [150,  0, 60,365,637,  0,638,  0,637,365, 60, 88,150],
    [150,150,150,150,150,150,150,150,150,150,150,150,150]
],
    "bgmap": [

],
    "fgmap": [
    [153,  0,20096,20097,20098,  0,  0,  0,20096,20097,20098,  0,153],
    [  0,  0,20104,20105,20106,  0,  0,  0,20104,20105,20106,  0,  0],
    [  0,  0,20112,20113,20114,  0,  0,  0,20112,20113,20114,  0,  0],
    [  0,  0,  0,  0,  0,20246,  0,20247,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "bg2map": [
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,20219,20220,20221,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,20227,20228,20229,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,20235,20236,20237,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
    [  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0]
],
    "fg2map": [

],
    "weather": [
        "cloud",
        5
    ]
}